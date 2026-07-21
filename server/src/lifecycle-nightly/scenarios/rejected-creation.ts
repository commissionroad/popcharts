import { pregradManagerAbi } from "@popcharts/protocol";

import {
  assertEqual,
  assertReverts,
  assertTruthy,
  CHAIN_STATUS,
} from "../asserts";
import { createLifecycleMarket } from "../market-factory";
import { assertMarketPaperTrail } from "../paper-trail";
import {
  fetchApiMarket,
  pregradManagerAddress,
  publicClient,
  walletFor,
  FIRST_TRADER_ACCOUNT_INDEX,
} from "../stack";
import { waitForCondition } from "../wait";
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
      const rejected = await waitForCondition(
        `market ${market.marketId} rejected`,
        async () => {
          const current = await fetchApiMarket(market.marketId);
          return current?.status === "rejected" ? current : null;
        },
        { tickChain: true, timeoutMs: 120_000 },
      );

      const review = assertTruthy("aiReview payload", rejected.aiReview);
      assertEqual("review verdict", review.verdict, "reject");
      if (!review.reasons || review.reasons.length === 0) {
        throw new Error("rejected market has no rejection reasons to show");
      }

      const state = await publicClient.readContract({
        abi: pregradManagerAbi,
        address: pregradManagerAddress,
        functionName: "getMarketState",
        args: [market.marketId],
      });
      assertEqual(
        "on-chain status after rejection",
        Number(state.status),
        CHAIN_STATUS.rejected,
      );
    });

    await step("rejected market refuses receipts", async () => {
      const trader = walletFor(FIRST_TRADER_ACCOUNT_INDEX);
      await assertReverts("placeReceipt on a rejected market", () =>
        publicClient.simulateContract({
          abi: pregradManagerAbi,
          account: trader.account,
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

    await step("paper trail records no money movement", () =>
      // No value ever moved, so the reconciliation proves the absence of
      // fabricated rows for this market.
      assertMarketPaperTrail({
        createdBlock: market.createdBlock,
        marketId: market.marketId,
      }),
    );
  },
};
