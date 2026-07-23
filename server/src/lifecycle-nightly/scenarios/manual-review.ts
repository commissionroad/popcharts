import { MARKET_STATUS } from "@popcharts/protocol";

import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

import { assertEqual, assertTruthy } from "../asserts";
import { createLifecycleMarket } from "../market-factory";
import { assertChainStatus, waitForApiStatus } from "../market-checks";
import { approveMarketAsReviewManager } from "../operator";
import { assertMarketPaperTrail } from "../paper-trail";
import { fetchApiMarket } from "../stack";
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
        { tickChain: true, timeoutMs: 135_000 },
      );

      const review = assertTruthy("aiReview payload", parked.aiReview);
      assertEqual("review verdict", review.verdict, "manual_review");
      // The verdict must NOT have transitioned the market — parked means
      // parked until a human decides.
      assertEqual("status stays parked", parked.status, "under_review");
      await assertChainStatus(
        "on-chain status stays under review",
        market.marketId,
        MARKET_STATUS.underReview,
      );
    });

    await step("operator approves with the review-manager key", async () => {
      await approveMarketAsReviewManager(market.marketId);

      await waitForApiStatus(market.marketId, "bootstrap", {
        timeoutMs: 60_000,
      });
      await assertChainStatus(
        "on-chain status after operator approval",
        market.marketId,
        MARKET_STATUS.active,
      );
    });

    await step("paper trail shows no collateral movement", async () => {
      // The native-token creation fee lives outside the collateral ledger
      // (contract-tracked); zero receipt rows plus a clean reconciliation
      // proves no collateral moved for this market.
      const receipts = await db
        .select()
        .from(schema.receiptPlacedEvents)
        .where(
          and(
            eq(schema.receiptPlacedEvents.chainId, config.chainId),
            eq(schema.receiptPlacedEvents.marketId, market.marketId),
          ),
        );
      assertEqual("receipt rows for the parked market", receipts.length, 0);

      await assertMarketPaperTrail({
        createdBlock: market.createdBlock,
        marketId: market.marketId,
      });
    });
  },
};
