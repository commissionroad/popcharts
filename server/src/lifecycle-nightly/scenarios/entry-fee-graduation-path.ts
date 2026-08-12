import { SIDE_YES } from "@popcharts/protocol";
import type { Address } from "viem";

import { schema } from "src/db/client";

import { assertEqual, assertTruthy } from "../asserts";
import { createLifecycleMarket } from "../market-factory";
import { waitForApiStatus, waitForIndexedRows } from "../market-checks";
import { setEntryFeeRateAsOwner } from "../operator";
import { assertMarketPaperTrailEventually } from "../paper-trail";
import { placeGraduationLiquidity, placeReceipt } from "../pregrad-trading";
import { SCENARIO_ACCOUNTS } from "../stack";
import { startService, stopService } from "../stack-control";
import {
  assertSingleFeeRow,
  expectedEntryFee,
  feeRowsOf,
  readEntryFeeRateWad,
  readFeeEscrow,
  readFeesEarned,
  type FeeRow,
} from "./entry-fee-checks";
import type { ScenarioContext } from "../report";

/**
 * Entry-fee graduation path: place → graduate → claim, on partial-clearing's
 * split book (balanced to threshold plus a one-sided YES excess, keeper
 * paused while it assembles). Placements run with the fee armed at 1%; the
 * live rate is then zeroed BEFORE the keeper's graduated claims, so the
 * earned/refunded splits must pay each receipt's stored fee. The split book
 * guarantees both split directions actually occur.
 */
export async function runGraduationPath(
  step: ScenarioContext["step"],
): Promise<void> {
  const market = await step("create the graduation-path market", () =>
    createLifecycleMarket({
      question: `Will the entry-fee graduation market split its fees? (run ${Date.now()})`,
      // Generous window, mirroring partial-clearing: balanced buys, the
      // excess receipt, the rate-zeroing transaction, and the keeper's
      // graduation pass must all land before the deadline; no resolution.
      graduationSeconds: 600,
      resolutionSeconds: 700,
    }),
  );

  await step("review runner approves via heuristic provider", () =>
    waitForApiStatus(market.marketId, "bootstrap", { timeoutMs: 135_000 }),
  );

  try {
    // Pause inside the try so the finally always restarts the keeper, even
    // if the stop request itself rejects mid-flight (partial-clearing's
    // pattern: the live ReceiptPlaced watcher would otherwise graduate the
    // balanced book before the excess lands).
    await step("pause the keeper to assemble the book atomically", () =>
      stopService("keeper"),
    );

    const balanced = await step(
      "place balanced liquidity to threshold (the retained band)",
      () =>
        placeGraduationLiquidity({
          marketId: market.marketId,
          thresholdWad: market.graduationThresholdWad,
          yesTraderAccountIndex: SCENARIO_ACCOUNTS.entryFeeGraduationYes,
          noTraderAccountIndex: SCENARIO_ACCOUNTS.entryFeeGraduationNo,
        }),
    );

    const excess = await step(
      "place one-sided YES excess (the fee-splitting receipt)",
      () =>
        placeReceipt({
          marketId: market.marketId,
          sharesWad: market.graduationThresholdWad / 4n,
          side: SIDE_YES,
          traderAccountIndex: SCENARIO_ACCOUNTS.entryFeeGraduationYes,
        }),
    );

    const receiptCount = balanced.receiptCount + 1;

    const placedRows = await step(
      "every placement carries a collected fee row",
      async () => {
        const placed = await waitForIndexedRows(
          `all ${receiptCount} receipts indexed`,
          schema.receiptPlacedEvents,
          market.marketId,
          receiptCount,
        );
        const feeRows = await waitForIndexedRows(
          `all ${receiptCount} collected fee rows indexed`,
          schema.receiptEntryFeeEvents,
          market.marketId,
          receiptCount,
        );
        assertEqual(
          "one collected row per placement",
          feeRows.length,
          receiptCount,
        );
        for (const row of placed) {
          assertSingleFeeRow("collected row", feeRows, {
            account: row.owner.toLowerCase(),
            amount: expectedEntryFee(row.cost),
            kind: "collected",
            receiptId: row.receiptId,
          });
        }
        assertEqual(
          "on-chain fee escrow holds every fee",
          await readFeeEscrow(market.marketId),
          placed.reduce((total, row) => total + expectedEntryFee(row.cost), 0n),
        );
        return placed;
      },
    );

    await step("zero the live rate before the graduated claims", async () => {
      // The claims below must pay each receipt's STORED fee, so force the
      // live rate to zero rather than restoring the pre-scenario rate here:
      // on a reused chain that rate can be nonzero — even exactly 1% — which
      // would let a derive-at-settlement bug produce the right numbers. At
      // zero, such a bug zeroes every split row and the exact-amount
      // assertions below catch it. The scenario's finally hands the true
      // pre-scenario rate back at the end.
      await setEntryFeeRateAsOwner(0n);
      assertEqual(
        "live rate zeroed before settlement",
        await readEntryFeeRateWad(),
        0n,
      );
    });

    await step("resume the keeper", () => startService("keeper"));

    const graduated = await step(
      "keeper graduates the market on a partial clearing",
      () =>
        waitForApiStatus(market.marketId, "graduated", {
          requirePostgrad: true,
          timeoutMs: 240_000,
        }),
    );

    await step("graduated claims split each fee by matched cost", async () => {
      const claims = await waitForIndexedRows(
        `all ${receiptCount} graduated-receipt claims indexed`,
        schema.graduatedReceiptClaimedEvents,
        market.marketId,
        receiptCount,
      );

      // Expected fee movements re-derived per receipt from its own facts —
      // cost from ReceiptPlaced, refund from the claim — with the contract's
      // own rounding (full-precision mulDiv, floor).
      const expected = claims.map((claim) => {
        const placed = assertTruthy(
          `ReceiptPlaced row for receipt ${claim.receiptId}`,
          placedRows.find((row) => row.receiptId === claim.receiptId),
        );
        const fee = expectedEntryFee(placed.cost);
        const refundedFee = (fee * claim.refund) / placed.cost;
        return {
          earnedFee: fee - refundedFee,
          owner: placed.owner.toLowerCase(),
          receiptId: claim.receiptId,
          refundedFee,
        };
      });

      // The split is genuinely two-sided: a fully-matched receipt keeps its
      // whole fee, and the crowded side's proration sends fee home — led by
      // the one-sided excess, which is why the book was assembled split.
      assertTruthy(
        "at least one receipt's fee is fully earned",
        expected.some(
          (entry) => entry.refundedFee === 0n && entry.earnedFee > 0n,
        ),
      );
      const excessExpected = assertTruthy(
        "expected fee split for the excess receipt",
        expected.find((entry) => entry.receiptId === excess.receiptId),
      );
      assertTruthy(
        "the excess receipt's fee partly refunds",
        excessExpected.refundedFee > 0n,
      );

      const expectedRowCount =
        receiptCount +
        expected.filter((entry) => entry.earnedFee > 0n).length +
        expected.filter((entry) => entry.refundedFee > 0n).length;
      const feeRows = await waitForIndexedRows(
        `all ${expectedRowCount} fee rows indexed after the claims`,
        schema.receiptEntryFeeEvents,
        market.marketId,
        expectedRowCount,
      );
      assertEqual(
        "no fee rows beyond collected plus the expected splits",
        feeRows.length,
        expectedRowCount,
      );

      for (const entry of expected) {
        if (entry.earnedFee > 0n) {
          assertSingleFeeRow("earned row", feeRows, {
            account: null,
            amount: entry.earnedFee,
            kind: "earned",
            receiptId: entry.receiptId,
          });
        } else {
          assertEqual(
            `receipt ${entry.receiptId}: no earned row`,
            feeRowsOf(feeRows, entry.receiptId, "earned").length,
            0,
          );
        }
        if (entry.refundedFee > 0n) {
          assertSingleFeeRow("refunded row", feeRows, {
            account: entry.owner,
            amount: entry.refundedFee,
            kind: "refunded",
            receiptId: entry.receiptId,
          });
        } else {
          assertEqual(
            `receipt ${entry.receiptId}: no refunded row`,
            feeRowsOf(feeRows, entry.receiptId, "refunded").length,
            0,
          );
        }
      }

      // Conservation across the market: every collected unit is either
      // earned or refunded, and the on-chain pots agree with the ledger.
      const totalByKind = (kind: FeeRow["kind"]) =>
        feeRows
          .filter((row) => row.kind === kind)
          .reduce((total, row) => total + row.amount, 0n);
      assertEqual(
        "collected equals earned plus refunded",
        totalByKind("collected"),
        totalByKind("earned") + totalByKind("refunded"),
      );
      assertEqual(
        "fee escrow drained by the claims",
        await readFeeEscrow(market.marketId),
        0n,
      );
      assertEqual(
        "earned pot matches the ledger",
        await readFeesEarned(market.marketId),
        totalByKind("earned"),
      );
    });

    await step("money paper trail balances end to end", () =>
      assertMarketPaperTrailEventually({
        createdBlock: market.createdBlock,
        marketId: market.marketId,
        postgradMarketAddress: graduated.postgrad?.marketAddress as Address,
      }),
    );
  } finally {
    // Safety net: the keeper must be running for later scenarios even if a
    // step above threw while it was paused. startService is idempotent, so
    // this is a no-op on the success path. Swallow its own failure so the
    // original step error still propagates as the diagnostic.
    await startService("keeper").catch((error: unknown) => {
      console.error(
        `[entry-fee] failed to restart the keeper during cleanup: ${
          error instanceof Error ? error.message : error
        }`,
      );
    });
  }
}
