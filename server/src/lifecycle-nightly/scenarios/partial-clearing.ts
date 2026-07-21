import { SIDE_YES } from "@popcharts/protocol";
import type { Address } from "viem";

import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

import { assertTruthy } from "../asserts";
import { createLifecycleMarket } from "../market-factory";
import { waitForApiStatus, waitForIndexedRows } from "../market-checks";
import { assertMarketPaperTrailEventually } from "../paper-trail";
import { placeGraduationLiquidity, placeReceipt } from "../pregrad-trading";
import { SCENARIO_ACCOUNTS } from "../stack";
import { startService, stopService } from "../stack-control";
import type { Scenario } from "../report";

/**
 * ADR 0014 unhappy path: partial clearing. Band-pass clearing matches a band
 * only where BOTH sides cover it; the crowded side's excess is prorated and
 * refunds. A graduated market claims EVERY receipt through the single
 * graduated-claim path, so the split shows up within
 * `graduated_receipt_claimed_events`: the scarce side is fully retained
 * (refund == 0) while crowded-side receipts refund their prorated excess
 * (refund > 0). Per receipt, retainedCost + refund == cost. (The no-match
 * `RefundedReceiptClaimed` path is a different lifecycle, covered by
 * failed-graduation.)
 *
 * Construction: a balanced book to the graduation threshold (guarantees the
 * matched cap clears) plus one one-sided YES receipt so YES is the crowded
 * side — its excess refunds without dropping the matched cap below the
 * threshold. The keeper is paused while the book is assembled: its live
 * ReceiptPlaced watcher would otherwise graduate the balanced book before
 * the excess is placed, yielding a full match instead of a partial.
 */
export const partialClearing: Scenario = {
  name: "partial-clearing",
  run: async ({ step }) => {
    const market = await step("create market on-chain", () =>
      createLifecycleMarket({
        question: `Will the partial-clearing lifecycle market graduate on a split book? (run ${Date.now()})`,
        // Generous window: balanced buys + the excess receipt + the keeper's
        // graduation pass must all land before the deadline; no resolution.
        graduationSeconds: 600,
        resolutionSeconds: 700,
      }),
    );

    await step("review runner approves via heuristic provider", () =>
      waitForApiStatus(market.marketId, "bootstrap", { timeoutMs: 135_000 }),
    );

    await step("pause the keeper to assemble the book atomically", () =>
      stopService("keeper"),
    );

    try {
      const balanced = await step(
        "place balanced liquidity to threshold (the retained band)",
        () =>
          placeGraduationLiquidity({
            marketId: market.marketId,
            thresholdWad: market.graduationThresholdWad,
            yesTraderAccountIndex: SCENARIO_ACCOUNTS.partialClearingYes,
            noTraderAccountIndex: SCENARIO_ACCOUNTS.partialClearingNo,
          }),
      );

      const excess = await step(
        "place one-sided YES excess (the refunded band)",
        () =>
          // A YES-only receipt on top of the balanced book: YES becomes the
          // crowded side, and its excess is prorated to refund while the
          // matched cap stays at the threshold.
          placeReceipt({
            marketId: market.marketId,
            sharesWad: market.graduationThresholdWad / 4n,
            side: SIDE_YES,
            traderAccountIndex: SCENARIO_ACCOUNTS.partialClearingExcess,
          }),
      );

      const totalReceipts = balanced.receiptCount + 1;

      await step("receipts reach the indexed paper trail", () =>
        waitForIndexedRows(
          `all ${totalReceipts} receipts indexed`,
          schema.receiptPlacedEvents,
          market.marketId,
          totalReceipts,
        ),
      );

      await step("resume the keeper", () => startService("keeper"));

      const graduated = await step(
        "keeper graduates the market on a partial clearing",
        () =>
          waitForApiStatus(market.marketId, "graduated", {
            requirePostgrad: true,
            timeoutMs: 240_000,
          }),
      );
      const postgradMarketAddress = graduated.postgrad
        ?.marketAddress as Address;

      await step("the clearing split is genuinely mixed", async () => {
        const claims = await waitForIndexedRows(
          `all ${totalReceipts} graduated-receipt claims indexed`,
          schema.graduatedReceiptClaimedEvents,
          market.marketId,
          totalReceipts,
        );

        // A real partial clearing: at least one receipt fully retained (the
        // scarce side) and at least one that refunds part or all of its cost
        // (the crowded side's prorated excess). Per-receipt
        // retainedCost + refund == cost is proven by assertMarketPaperTrail.
        const fullyRetained = claims.filter((claim) => claim.refund === 0n);
        const refunded = claims.filter((claim) => claim.refund > 0n);
        if (fullyRetained.length === 0) {
          throw new Error(
            `expected at least one fully-retained receipt (refund 0), got none of ${claims.length}`,
          );
        }
        if (refunded.length === 0) {
          throw new Error(
            `expected at least one refunded receipt (refund > 0), got none of ${claims.length}`,
          );
        }

        // The excess YES receipt is on the crowded side, so it carries part
        // of the refund.
        const excessClaim = assertTruthy(
          "excess receipt claim",
          claims.find((claim) => claim.receiptId === excess.receiptId),
        );
        if (excessClaim.refund <= 0n) {
          throw new Error(
            `expected the one-sided excess receipt to refund, got refund ${excessClaim.refund}`,
          );
        }
      });

      await step(
        "graduation finalized with a non-zero refund total",
        async () => {
          const [finalized] = await db
            .select()
            .from(schema.graduationFinalizedEvents)
            .where(
              and(
                eq(schema.graduationFinalizedEvents.chainId, config.chainId),
                eq(schema.graduationFinalizedEvents.marketId, market.marketId),
              ),
            )
            .limit(1);
          const row = assertTruthy("graduation finalized row", finalized);
          if (row.refundTotal <= 0n) {
            throw new Error(
              `expected a non-zero refund total for a partial clearing, got ${row.refundTotal}`,
            );
          }
          if (row.retainedCostTotal <= 0n) {
            throw new Error(
              `expected a non-zero retained cost total, got ${row.retainedCostTotal}`,
            );
          }
        },
      );

      await step("money paper trail balances end to end", () =>
        assertMarketPaperTrailEventually({
          createdBlock: market.createdBlock,
          marketId: market.marketId,
          postgradMarketAddress,
        }),
      );
    } finally {
      // Safety net: the keeper must be running for later scenarios even if a
      // step above threw while it was paused. startService is idempotent, so
      // this is a no-op on the success path.
      await startService("keeper");
    }
  },
};
