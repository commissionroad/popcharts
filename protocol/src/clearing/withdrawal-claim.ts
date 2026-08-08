import { normalizePathSegments, segmentsSidePathCost, type PathSegment } from "./opposed-set.js";

/**
 * Route-2 prototype for the ADR 0014 P3 opposed-set question, following the
 * ADR 0006 optimistic shape (compute off chain, verify on chain, challenge
 * window): the withdrawer computes their free set off chain and submits it as
 * a claim. The contract verifies everything checkable from the receipt alone
 * — ownership, liveness, containment, and the refund amount, which is the
 * same closed-form path cost the LMSR quote path already computes — and
 * removes the claimed segments from the receipt's live support immediately,
 * paying the refund only after the challenge window.
 *
 * The one statement the contract cannot check is the claim's point:
 * "no live opposite-side receipt covers these segments" asserts an absence
 * over a mapping with no per-market enumeration. The optimistic pattern is at
 * its strongest here, because the absence is refutable by a single positive
 * example: a challenger names one opposite-side receipt id, and the contract
 * loads it from the global receipt mapping and checks market, side,
 * liveness, and interval overlap — O(1) storage reads regardless of book
 * size.
 *
 * Two rules make the challenge sound against races:
 *
 * - Claimed segments leave the live book at request time but stay recorded on
 *   the request until finalization, and pending segments still count for
 *   refutation. A fraudulent claim therefore stays refutable even when its
 *   opposing coverage requests withdrawal right after it (the opposer's own
 *   finalization deadline is always later, so the overlap is still recorded
 *   whenever the first claim can be challenged).
 * - `nextReceiptIdSnapshot` pins the refutation set to receipts that existed
 *   at request time. Coverage placed during the window cannot refute, so an
 *   honest withdrawal cannot be invalidated by opposition that arrived after
 *   its segments had already left the live book.
 */

/** A receipt as the withdrawal path sees it: P1's segmented live support. */
export type SegmentedReceipt = {
  /** False once the receipt is settled; withdrawn segments also leave `segments`. */
  active: boolean;
  marketId: bigint;
  receiptId: bigint;
  /**
   * Live support, sorted and disjoint. Segments pending withdrawal stay
   * recorded here until their request finalizes.
   */
  segments: PathSegment[];
  side: number;
};

/** The withdrawal claim a requester submits: the free set it asserts. */
export type WithdrawalClaim = {
  marketId: bigint;
  /**
   * `nextReceiptId` observed at request time. Receipts allocated at or after
   * it were placed after the claimed segments left the live book and cannot
   * refute the claim.
   */
  nextReceiptIdSnapshot: bigint;
  receiptId: bigint;
  /** Segments asserted unopposed, sorted ascending and disjoint. */
  segments: PathSegment[];
};

/** What the contract can verify about a claim at request time. */
export type WithdrawalClaimVerification = {
  /** Pure comparisons run (segment ordering plus containment). */
  comparisons: number;
  /** Storage records loaded: the receipt's fields and live segments. */
  recordsLoaded: number;
  /**
   * Gross refund: the claimed segments' recorded path cost. The withdrawal
   * fee (ADR 0014 P4b) applies to this amount at payout.
   */
  refund: bigint;
};

/** Outcome of one refutation attempt against a pending claim. */
export type WithdrawalChallengeResult = {
  /** Pure comparisons run (identity, side, and overlap checks). */
  comparisons: number;
  /** Storage records loaded: the named receipt plus the pending claim. */
  recordsLoaded: number;
  /** True when the named receipt proves a claimed segment was opposed. */
  refuted: boolean;
};

/**
 * The deterministic checks a contract runs at request time. Throws — the
 * revert analogue — when the claim is malformed: wrong receipt, settled
 * receipt, unordered or overlapping segments, or segments outside the
 * receipt's live support. Returns the refund those segments' recorded path
 * cost adds up to.
 */
export function verifyWithdrawalClaim({
  claim,
  liquidityParameter,
  receipt,
}: {
  claim: WithdrawalClaim;
  liquidityParameter: bigint;
  receipt: SegmentedReceipt;
}): WithdrawalClaimVerification {
  let comparisons = 0;
  const check = (condition: boolean, message: string): void => {
    comparisons += 1;
    if (!condition) throw new Error(`Invalid withdrawal claim: ${message}.`);
  };

  check(claim.receiptId === receipt.receiptId, "receipt id mismatch");
  check(claim.marketId === receipt.marketId, "market id mismatch");
  check(receipt.active, "receipt is settled");
  check(claim.segments.length > 0, "no segments claimed");

  let previousHigh: bigint | undefined;
  for (const segment of claim.segments) {
    check(segment.rHigh > segment.rLow, "empty or inverted segment");
    if (previousHigh !== undefined) {
      check(segment.rLow >= previousHigh, "segments unordered or overlapping");
    }
    previousHigh = segment.rHigh;
    const container = receipt.segments.find(
      (live) => live.rLow <= segment.rLow && live.rHigh >= segment.rHigh,
    );
    comparisons += receipt.segments.length;
    check(container !== undefined, "segment outside live support");
  }

  return {
    comparisons,
    // The whole receipt record: identity, side, liveness, and its live
    // segment list (two words per segment).
    recordsLoaded: 4 + receipt.segments.length,
    refund: segmentsSidePathCost(claim.segments, receipt.side, liquidityParameter),
  };
}

/**
 * The challenge check: one named opposite-side receipt either proves a
 * claimed segment was opposed at request time, or the challenge fails. Never
 * throws — a failed refutation is an answer, not an error.
 */
export function refuteWithdrawalClaim({
  claim,
  claimantSide,
  namedReceipt,
}: {
  claim: WithdrawalClaim;
  claimantSide: number;
  namedReceipt: SegmentedReceipt;
}): WithdrawalChallengeResult {
  // The pending claim record plus the named receipt's fields and segments.
  const recordsLoaded = 3 + claim.segments.length + 4 + namedReceipt.segments.length;
  let comparisons = 4;

  const eligible =
    namedReceipt.marketId === claim.marketId &&
    namedReceipt.side !== claimantSide &&
    namedReceipt.active &&
    namedReceipt.receiptId < claim.nextReceiptIdSnapshot;
  if (!eligible) return { comparisons, recordsLoaded, refuted: false };

  const covering = normalizePathSegments(namedReceipt.segments);
  for (const claimed of claim.segments) {
    for (const cover of covering) {
      comparisons += 1;
      const overlapLow = cover.rLow > claimed.rLow ? cover.rLow : claimed.rLow;
      const overlapHigh = cover.rHigh < claimed.rHigh ? cover.rHigh : claimed.rHigh;
      if (overlapLow < overlapHigh) {
        return { comparisons, recordsLoaded, refuted: true };
      }
    }
  }
  return { comparisons, recordsLoaded, refuted: false };
}

/**
 * ABI-encoded calldata size of `requestWithdrawal(uint256 receiptId,
 * (int256,int256)[] segments)`: selector, receiptId word, dynamic-array
 * offset and length words, then two words per segment. The snapshot is read
 * from storage at request time, not passed in.
 */
export function withdrawalRequestCalldataBytes(segmentCount: number): number {
  return 4 + 32 + 32 + 32 + segmentCount * 64;
}

/**
 * ABI-encoded calldata size of `challengeWithdrawal(uint256 receiptId,
 * uint256 counterexampleReceiptId)`: selector plus two words.
 */
export function withdrawalChallengeCalldataBytes(): number {
  return 4 + 32 + 32;
}
