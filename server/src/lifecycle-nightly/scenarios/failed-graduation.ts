import { pregradManagerAbi, SIDE_NO, SIDE_YES } from "@popcharts/protocol";
import { parseUnits } from "viem";

import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

import { assertEqual, assertReverts, CHAIN_STATUS } from "../asserts";
import { jumpChainTimeTo } from "../chain-time";
import { createLifecycleMarket } from "../market-factory";
import { assertMarketPaperTrail } from "../paper-trail";
import {
  fetchApiMarket,
  pregradManagerAddress,
  publicClient,
  walletFor,
} from "../stack";
import { claimRefundedReceipt, placeReceipt } from "../pregrad-trading";
import { waitForCondition } from "../wait";
import type { Scenario } from "../report";

const YES_TRADER = 14;
const NO_TRADER = 15;

/**
 * ADR 0014 unhappy path: a market that never matches enough liquidity
 * reaches its graduation deadline, the keeper's sweep settles the no-match
 * outcome by opening full escrow refunds (the real service path — no dev
 * close endpoint), and both receipt owners claim their full cost back.
 */
export const failedGraduation: Scenario = {
  name: "failed-graduation",
  run: async ({ step }) => {
    const market = await step("create market with a short deadline", () =>
      createLifecycleMarket({
        question: `Will the under-liquidity lifecycle market graduate? (run ${Date.now()})`,
        // Short window: the deadline only needs to outlive review approval
        // plus two small receipts; everything after is a chain-time jump.
        graduationSeconds: 180,
        resolutionSeconds: 200,
      }),
    );

    await step("review runner approves via heuristic provider", async () => {
      await waitForCondition(
        `market ${market.marketId} approved`,
        async () => {
          const current = await fetchApiMarket(market.marketId);
          return current?.status === "bootstrap" ? current : null;
        },
        { tickChain: true, timeoutMs: 90_000 },
      );
    });

    const receipts = await step(
      "traders place below-threshold receipts",
      async () => {
        // 50 shares a side against the 2,500 threshold: real escrow at
        // stake, nowhere near graduating.
        const yes = await placeReceipt({
          marketId: market.marketId,
          sharesWad: parseUnits("50", 18),
          side: SIDE_YES,
          traderAccountIndex: YES_TRADER,
        });
        const no = await placeReceipt({
          marketId: market.marketId,
          sharesWad: parseUnits("50", 18),
          side: SIDE_NO,
          traderAccountIndex: NO_TRADER,
        });
        return { no, yes };
      },
    );

    await step("receipts reach the indexed paper trail", async () => {
      await waitForCondition(
        "both receipts indexed",
        async () => {
          const rows = await db
            .select()
            .from(schema.receiptPlacedEvents)
            .where(
              and(
                eq(schema.receiptPlacedEvents.chainId, config.chainId),
                eq(schema.receiptPlacedEvents.marketId, market.marketId),
              ),
            );
          return rows.length >= 2 ? rows : null;
        },
        { tickChain: true, timeoutMs: 30_000 },
      );
    });

    await step("keeper opens refunds after the deadline passes", async () => {
      await jumpChainTimeTo(market.graduationDeadline + 1n);

      // The keeper's periodic sweep (30s cadence) finds the past-deadline
      // market ineligible and settles the no-match outcome via
      // markRefundable — no scenario-side nudge is possible because the
      // contract rejects new receipts past the deadline.
      const refunded = await waitForCondition(
        `market ${market.marketId} refunded`,
        async () => {
          const current = await fetchApiMarket(market.marketId);
          return current?.status === "refunded" ? current : null;
        },
        { tickChain: true, timeoutMs: 120_000 },
      );
      assertEqual("post-deadline status", refunded.status, "refunded");

      const state = await publicClient.readContract({
        abi: pregradManagerAbi,
        address: pregradManagerAddress,
        functionName: "getMarketState",
        args: [market.marketId],
      });
      assertEqual(
        "on-chain status after refund opens",
        Number(state.status),
        CHAIN_STATUS.refunded,
      );

      await waitForCondition(
        "MarketRefundsAvailable reaches the indexed paper trail",
        async () => {
          const rows = await db
            .select()
            .from(schema.marketRefundsAvailableEvents)
            .where(
              and(
                eq(schema.marketRefundsAvailableEvents.chainId, config.chainId),
                eq(
                  schema.marketRefundsAvailableEvents.marketId,
                  market.marketId,
                ),
              ),
            );
          return rows.length > 0 ? rows : null;
        },
        { tickChain: true, timeoutMs: 30_000 },
      );
    });

    await step("both owners claim full refunds", async () => {
      const yesClaim = await claimRefundedReceipt({
        receiptId: receipts.yes.receiptId,
        traderAccountIndex: YES_TRADER,
      });
      assertEqual(
        "YES owner refunded exactly the receipt cost",
        yesClaim.refunded,
        receipts.yes.cost,
      );

      const noClaim = await claimRefundedReceipt({
        receiptId: receipts.no.receiptId,
        traderAccountIndex: NO_TRADER,
      });
      assertEqual(
        "NO owner refunded exactly the receipt cost",
        noClaim.refunded,
        receipts.no.cost,
      );

      await waitForCondition(
        "refund claims reach the indexed paper trail",
        async () => {
          const rows = await db
            .select()
            .from(schema.refundedReceiptClaimedEvents)
            .where(
              and(
                eq(schema.refundedReceiptClaimedEvents.chainId, config.chainId),
                eq(
                  schema.refundedReceiptClaimedEvents.marketId,
                  market.marketId,
                ),
              ),
            );
          return rows.length >= 2 ? rows : null;
        },
        { tickChain: true, timeoutMs: 30_000 },
      );
    });

    await step("double-claim is rejected on-chain", async () => {
      const trader = walletFor(YES_TRADER);
      await assertReverts("second claim of the same receipt", () =>
        publicClient.simulateContract({
          abi: pregradManagerAbi,
          account: trader.account,
          address: pregradManagerAddress,
          functionName: "claimRefundedReceipt",
          args: [receipts.yes.receiptId],
        }),
      );
    });

    await step("money paper trail balances end to end", () =>
      assertMarketPaperTrail({
        createdBlock: market.createdBlock,
        marketId: market.marketId,
      }),
    );
  },
};
