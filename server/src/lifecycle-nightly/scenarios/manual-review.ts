import { pregradManagerAbi } from "@popcharts/protocol";

import { assertEqual, assertTruthy, CHAIN_STATUS } from "../asserts";
import { createLifecycleMarket } from "../market-factory";
import { approveMarketAsReviewManager } from "../operator";
import { assertMarketPaperTrail } from "../paper-trail";
import { fetchApiMarket, pregradManagerAddress, publicClient } from "../stack";
import { waitForCondition } from "../wait";
import type { Scenario } from "../report";

/**
 * ADR 0014 unhappy path: an ambiguous market parks in under_review (the
 * heuristic's retrospective_question soft flag yields a manual_review
 * verdict, which transitions nothing), then the operator approves it with
 * the review-manager key — the real operator lever; the admin API endpoint
 * only re-queues AI reviews, it cannot decide — and the market proceeds to
 * bootstrap.
 *
 * The market ends bootstrap (not terminal), which is safe to leave behind:
 * it holds zero escrow, later scenarios never jump chain time past its
 * distant deadline, and on long-lived local stacks the keeper eventually
 * settles it as a no-match refund with nothing to claim.
 */
export const manualReview: Scenario = {
  name: "manual-review",
  run: async ({ step }) => {
    const market = await step("create ambiguous (retrospective) market", () =>
      createLifecycleMarket({
        // A past-tense opener with no anchoring future year reads as a
        // lookup of an already-decided event — the review heuristic parks
        // it for a human instead of approving or rejecting. The criteria
        // must not mention a year or the flag stops firing.
        question: "Did the stadium rollout finish on schedule?",
        resolutionCriteria: `Resolves from the named source's archived rollout report. (run ${Date.now()})`,
      }),
    );

    await step("review parks the market for a human", async () => {
      const parked = await waitForCondition(
        `market ${market.marketId} parked with a manual_review verdict`,
        async () => {
          const current = await fetchApiMarket(market.marketId);
          return current?.aiReview ? current : null;
        },
        { tickChain: true, timeoutMs: 120_000 },
      );

      const review = assertTruthy("aiReview payload", parked.aiReview);
      assertEqual("review verdict", review.verdict, "manual_review");
      // The verdict must NOT have transitioned the market — parked means
      // parked until a human decides.
      assertEqual("status stays parked", parked.status, "under_review");

      const state = await publicClient.readContract({
        abi: pregradManagerAbi,
        address: pregradManagerAddress,
        functionName: "getMarketState",
        args: [market.marketId],
      });
      assertEqual(
        "on-chain status stays under review",
        Number(state.status),
        CHAIN_STATUS.underReview,
      );
    });

    await step("operator approves with the review-manager key", async () => {
      await approveMarketAsReviewManager(market.marketId);

      const approved = await waitForCondition(
        `market ${market.marketId} proceeds to bootstrap`,
        async () => {
          const current = await fetchApiMarket(market.marketId);
          return current?.status === "bootstrap" ? current : null;
        },
        { tickChain: true, timeoutMs: 60_000 },
      );
      assertEqual("post-approval status", approved.status, "bootstrap");

      const state = await publicClient.readContract({
        abi: pregradManagerAbi,
        address: pregradManagerAddress,
        functionName: "getMarketState",
        args: [market.marketId],
      });
      assertEqual(
        "on-chain status after operator approval",
        Number(state.status),
        CHAIN_STATUS.active,
      );
    });

    await step("paper trail records no money movement", () =>
      assertMarketPaperTrail({
        createdBlock: market.createdBlock,
        marketId: market.marketId,
      }),
    );
  },
};
