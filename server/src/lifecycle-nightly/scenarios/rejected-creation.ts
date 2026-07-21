import { MARKET_STATUS, pregradManagerAbi } from "@popcharts/protocol";

import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

import { assertEqual, assertReverts, assertTruthy } from "../asserts";
import { createLifecycleMarket } from "../market-factory";
import { assertChainStatus, waitForApiStatus } from "../market-checks";
import { assertMarketPaperTrail } from "../paper-trail";
import {
  SCENARIO_ACCOUNTS,
  pregradManagerAddress,
  publicClient,
  walletFor,
} from "../stack";
import type { Scenario } from "../report";

/**
 * ADR 0014 unhappy path: a policy-violating market is rejected by the real
 * review runner (heuristic hard flag), the rejection reasons are served to
 * the creator, and the market is terminally closed to trading. Rejection is
 * terminal on-chain — no operator path reopens it.
 */
export const rejectedCreation: Scenario = {
  name: "rejected-creation",
  run: async ({ step }) => {
    const market = await step("create policy-violating market", () =>
      createLifecycleMarket({
        // "hacked" trips the review heuristic's illegal_activity hard rule —
        // a hard flag rejects regardless of the otherwise-clean phrasing.
        question: `Will the exchange be hacked before the finals? (run ${Date.now()})`,
        resolutionCriteria:
          "Resolves from the named source's incident disclosures.",
      }),
    );

    await step("review runner rejects via heuristic hard flag", async () => {
      const rejected = await waitForApiStatus(market.marketId, "rejected", {
        timeoutMs: 135_000,
      });

      const review = assertTruthy("aiReview payload", rejected.aiReview);
      assertEqual("review verdict", review.verdict, "reject");
      if (!review.reasons || review.reasons.length === 0) {
        throw new Error("rejected market has no rejection reasons to show");
      }

      await assertChainStatus(
        "on-chain status after rejection",
        market.marketId,
        MARKET_STATUS.rejected,
      );
    });

    await step("rejected market refuses receipts", async () => {
      const prober = walletFor(SCENARIO_ACCOUNTS.receiptProbe);
      await assertReverts("placeReceipt on a rejected market", () =>
        publicClient.simulateContract({
          abi: pregradManagerAbi,
          account: prober.account,
          address: pregradManagerAddress,
          functionName: "placeReceipt",
          args: [
            {
              marketId: market.marketId,
              maxCost: 10n ** 18n,
              shares: 10n ** 18n,
              side: 0,
            },
          ],
        }),
      );
    });

    await step("paper trail shows no collateral movement", async () => {
      // The native-token creation fee is tracked by the contract
      // (collectedCreationFees) outside the collateral ledger; the paper
      // trail this suite guards is the collateral one. Zero receipt rows
      // plus a clean two-way reconciliation proves no collateral moved and
      // nothing was fabricated for this market.
      const receipts = await db
        .select()
        .from(schema.receiptPlacedEvents)
        .where(
          and(
            eq(schema.receiptPlacedEvents.chainId, config.chainId),
            eq(schema.receiptPlacedEvents.marketId, market.marketId),
          ),
        );
      assertEqual("receipt rows for a rejected market", receipts.length, 0);

      await assertMarketPaperTrail({
        createdBlock: market.createdBlock,
        marketId: market.marketId,
      });
    });
  },
};
