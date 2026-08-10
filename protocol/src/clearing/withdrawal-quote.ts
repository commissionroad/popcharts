import { WAD } from "../wad.js";
import { segmentSidePathCost, splitOpposedFree } from "./opposed-set.js";
import type { SegmentedReceipt } from "./withdrawal-claim.js";

/**
 * Pre-graduation withdrawal quote (ADR 0014 P2, whitepaper v0.6 §7).
 *
 * Quotes what a receipt holder would receive for withdrawing every free band
 * of their receipt right now: the free set comes from {@link splitOpposedFree}
 * over the live opposite-side coverage, and each free segment is priced at its
 * own recorded path cost by the same closed-form band cost clearing uses. The
 * quote's free set IS the split's free set — withdrawing everything quoted is
 * exactly the Lemma 3 operation that leaves `F` bit-identical.
 *
 * Rounding convention (the one place it is decided): the withdrawal fee is
 * computed once on the gross refund as a full-precision multiply then floor
 * divide, `grossRefund * feeRateWad / WAD` in bigint — mirroring the
 * contract's entry fee, `Math.mulDiv(cost, entryFeeRateWad, 1e18)` in
 * `PregradManager.entryFeeFor`, which rounds the fee down so the dust wei
 * stays with the trader. The fee applies to the request's gross, not per
 * segment, matching P3's request shape: `verifyWithdrawalRequest` prices the
 * whole claim as one refund and P4b charges φ_out on that amount at payout.
 * Per-segment flooring would differ by up to one wei per extra segment and
 * make the payout depend on fragmentation. P3/P4b must implement this same
 * formula on chain so a quote and the eventual payout can never disagree.
 */

/** One free segment of a quote, priced at its own recorded path cost. */
export type QuotedFreeSegment = {
  /** Recorded path cost of this segment for the receipt's side, in WAD. */
  cost: bigint;
  rHigh: bigint;
  rLow: bigint;
};

/** Result of {@link quoteWithdrawal}. `netPayout + fee === grossRefund`. */
export type WithdrawalQuote = {
  /** The withdrawal fee: `grossRefund * feeRateWad / WAD`, floored. */
  fee: bigint;
  /** The receipt's free segments, normalized and ascending. */
  freeSegments: QuotedFreeSegment[];
  /** Sum of the free segments' recorded path costs. */
  grossRefund: bigint;
  /** What the withdrawer receives: `grossRefund - fee`. */
  netPayout: bigint;
};

/**
 * Quotes a full free-set withdrawal for one receipt against the live book.
 * A fully opposed receipt quotes an empty free set and zero throughout.
 * Throws on an unknown or settled receipt and on a fee rate outside
 * [0, WAD] — a rate above 100% would quote a negative payout. Policy caps
 * below 100% are P4b's to enforce on chain.
 */
export function quoteWithdrawal({
  book,
  feeRateWad,
  liquidityParameter,
  receiptId,
}: {
  book: readonly SegmentedReceipt[];
  feeRateWad: bigint;
  liquidityParameter: bigint;
  receiptId: bigint;
}): WithdrawalQuote {
  if (feeRateWad < 0n || feeRateWad > WAD) {
    throw new Error(`Withdrawal fee rate ${feeRateWad} outside [0, ${WAD}].`);
  }
  const receipt = book.find((row) => row.receiptId === receiptId);
  if (receipt === undefined) {
    throw new Error(`Unknown receipt ${receiptId}.`);
  }
  if (!receipt.active) {
    throw new Error(`Receipt ${receiptId} is settled.`);
  }

  // "Opposed once any live opposite-side receipt covers it": only active
  // rows of the same market oppose. Settled rows' segments are already out
  // of the live book, and the filter keeps a mixed-market book honest.
  const oppositeCoverage = book
    .filter((row) => row.active && row.marketId === receipt.marketId && row.side !== receipt.side)
    .flatMap((row) => row.segments);

  const { free } = splitOpposedFree(receipt.segments, oppositeCoverage);
  const freeSegments = free.map((segment) => ({
    cost: segmentSidePathCost(segment, receipt.side, liquidityParameter),
    rHigh: segment.rHigh,
    rLow: segment.rLow,
  }));
  const grossRefund = freeSegments.reduce((sum, segment) => sum + segment.cost, 0n);
  const fee = (grossRefund * feeRateWad) / WAD;
  return { fee, freeSegments, grossRefund, netPayout: grossRefund - fee };
}
