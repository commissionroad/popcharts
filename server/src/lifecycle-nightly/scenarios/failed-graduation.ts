import {
  MARKET_STATUS,
  pregradManagerAbi,
  SIDE_NO,
  SIDE_YES,
} from "@popcharts/protocol";
import { parseUnits } from "viem";

import { schema } from "src/db/client";

import { assertEqual, assertReverts } from "../asserts";
import { jumpChainTimeTo } from "../chain-time";
import { createLifecycleMarket } from "../market-factory";
import {
  assertChainStatus,
  waitForApiStatus,
  waitForIndexedRows,
} from "../market-checks";
import { assertMarketPaperTrail } from "../paper-trail";
import {
  SCENARIO_ACCOUNTS,
  pregradManagerAddress,
  publicClient,
  walletFor,
} from "../stack";
import { claimRefundedReceipt, placeReceipt } from "../pregrad-trading";
import type { Scenario } from "../report";

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
        // The window only needs to outlive review approval (135s budget
        // below) plus two receipts; everything after is a chain-time jump.
        graduationSeconds: 240,
        resolutionSeconds: 250,
      }),
    );

    await step("review runner approves via heuristic provider", async () => {
      // Budget covers creation-tx indexing plus the runner's poll and the
      // approval round-trip — the same pipeline happy-path splits into a
      // 45s indexing wait and a 90s review wait.
      await waitForApiStatus(market.marketId, "bootstrap", {
        timeoutMs: 135_000,
      });
    });

    const receipts = await step(
      "traders place below-threshold receipts",
      async () => {
        // 50 shares a side against the 2,500 threshold: real escrow at
        // stake, nowhere near graduating. The two traders are distinct
        // accounts funding themselves, so the buys run concurrently; the
        // quotes interact under LMSR but the 10% slippage buffer dwarfs
        // the movement two 50-share orders can cause, and every cost
        // assertion uses the ReceiptPlaced event value, not the quote.
        const [yes, no] = await Promise.all([
          placeReceipt({
            marketId: market.marketId,
            sharesWad: parseUnits("50", 18),
            side: SIDE_YES,
            traderAccountIndex: SCENARIO_ACCOUNTS.failedGraduationYes,
          }),
          placeReceipt({
            marketId: market.marketId,
            sharesWad: parseUnits("50", 18),
            side: SIDE_NO,
            traderAccountIndex: SCENARIO_ACCOUNTS.failedGraduationNo,
          }),
        ]);
        return { no, yes };
      },
    );

    await step("receipts reach the indexed paper trail", () =>
      waitForIndexedRows(
        "both receipts indexed",
        schema.receiptPlacedEvents,
        market.marketId,
        2,
      ),
    );

    await step("keeper opens refunds after the deadline passes", async () => {
      await jumpChainTimeTo(market.graduationDeadline + 1n);

      // The keeper's periodic sweep (30s cadence) finds the past-deadline
      // market ineligible and settles the no-match outcome via
      // markRefundable — no scenario-side nudge is possible because the
      // contract rejects new receipts past the deadline.
      await waitForApiStatus(market.marketId, "refunded", {
        timeoutMs: 120_000,
      });
      await assertChainStatus(
        "on-chain status after refund opens",
        market.marketId,
        MARKET_STATUS.refunded,
      );
      await waitForIndexedRows(
        "MarketRefundsAvailable reaches the indexed paper trail",
        schema.marketRefundsAvailableEvents,
        market.marketId,
        1,
      );
    });

    await step("both owners claim full refunds", async () => {
      // Distinct accounts again — the claims are independent transactions.
      const [yesClaim, noClaim] = await Promise.all([
        claimRefundedReceipt({
          receiptId: receipts.yes.receiptId,
          traderAccountIndex: SCENARIO_ACCOUNTS.failedGraduationYes,
        }),
        claimRefundedReceipt({
          receiptId: receipts.no.receiptId,
          traderAccountIndex: SCENARIO_ACCOUNTS.failedGraduationNo,
        }),
      ]);
      assertEqual(
        "YES owner refunded exactly the receipt cost",
        yesClaim.refunded,
        receipts.yes.cost,
      );
      assertEqual(
        "NO owner refunded exactly the receipt cost",
        noClaim.refunded,
        receipts.no.cost,
      );

      await waitForIndexedRows(
        "refund claims reach the indexed paper trail",
        schema.refundedReceiptClaimedEvents,
        market.marketId,
        2,
      );
    });

    await step("double-claim is rejected on-chain", async () => {
      const trader = walletFor(SCENARIO_ACCOUNTS.failedGraduationYes);
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
