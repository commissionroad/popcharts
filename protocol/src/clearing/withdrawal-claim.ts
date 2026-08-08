import {
  normalizePathSegments,
  segmentsSidePathCost,
  splitOpposedFree,
  type PathSegment,
} from "./opposed-set.js";

/**
 * Route-2 prototype for the ADR 0014 P3 opposed-set question, following the
 * ADR 0006 optimistic shape (compute off chain, verify on chain, challenge
 * window): the withdrawer computes their free set off chain and submits it as
 * a claim. The contract verifies everything checkable from the receipt alone
 * — ownership, liveness, containment, and the refund amount, which is the
 * same closed-form path cost the LMSR quote path already computes — and
 * removes the claimed segments from the receipt's live support immediately,
 * paying the refund only after the challenge window. A request never checks
 * opposition: that is the unverifiable negative, so a structurally valid
 * false claim is accepted and dies by challenge — or, at the v1 zero window,
 * by the attesting service refusing to sign it.
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
 * Three rules make the challenge sound against races, and
 * {@link WithdrawalRequestModel} implements them so the tests can prove the
 * collusion chain fails rather than assert it:
 *
 * - Claimed segments leave the live book at request time but stay recorded on
 *   the pending request until finalization, and pending-recorded segments
 *   still refute. A colluding pair requesting both sides of an opposed band
 *   is therefore refutable in order: the first claim by the second's
 *   pending-recorded coverage, the second by the first's restored coverage.
 * - A request's challenge deadline is stamped at request time and is never
 *   earlier than any prior request's. Challenges land strictly inside the
 *   window (`now < deadline`) while finalization waits for it
 *   (`now >= deadline`), so a dependent claim can never finalize while the
 *   claim that enabled it is still challengeable — later-or-equal ordering
 *   is enough, same-block equality included.
 * - `nextReceiptIdSnapshot` is stamped from the book's own `nextReceiptId` at
 *   request time, never accepted from the requester, and pins the refutation
 *   set to receipts that existed then. Coverage placed during the window
 *   cannot refute, so an honest withdrawal cannot be invalidated by
 *   opposition that arrived after its segments had already left the live
 *   book — and a requester cannot choose a low snapshot to disarm every
 *   refutation.
 */

/** A receipt as the withdrawal path sees it: P1's segmented live support. */
export type SegmentedReceipt = {
  /** False once the receipt is settled; withdrawn segments also leave `segments`. */
  active: boolean;
  marketId: bigint;
  receiptId: bigint;
  /** Live support, sorted and disjoint. */
  segments: PathSegment[];
  side: number;
};

/** The calldata a requester submits: the free set it asserts, nothing more. */
export type WithdrawalRequestInput = {
  receiptId: bigint;
  /** Segments asserted unopposed, sorted ascending and disjoint. */
  segments: PathSegment[];
};

/** The recorded claim the contract stores; every field is contract-stamped. */
export type WithdrawalClaim = {
  marketId: bigint;
  /**
   * `nextReceiptId` read at request time. Receipts allocated at or after it
   * were placed after the claimed segments left the live book and cannot
   * refute the claim.
   */
  nextReceiptIdSnapshot: bigint;
  receiptId: bigint;
  /** The claimed segments, recorded here until the request finalizes. */
  segments: PathSegment[];
};

/** What the contract can verify about a request at request time. */
export type WithdrawalRequestVerification = {
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
 * revert analogue — when the request is malformed: wrong receipt, settled
 * receipt, unordered or overlapping segments, or segments outside the
 * receipt's live support. Returns the refund those segments' recorded path
 * cost adds up to. Deliberately no opposition check (see the module note).
 */
export function verifyWithdrawalRequest({
  liquidityParameter,
  receipt,
  request,
}: {
  liquidityParameter: bigint;
  receipt: SegmentedReceipt;
  request: WithdrawalRequestInput;
}): WithdrawalRequestVerification {
  let comparisons = 0;
  const check = (condition: boolean, message: string): void => {
    comparisons += 1;
    if (!condition) throw new Error(`Invalid withdrawal request: ${message}.`);
  };

  check(request.receiptId === receipt.receiptId, "receipt id mismatch");
  check(receipt.active, "receipt is settled");
  check(request.segments.length > 0, "no segments claimed");

  let previousHigh: bigint | undefined;
  for (const segment of request.segments) {
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
    refund: segmentsSidePathCost(request.segments, receipt.side, liquidityParameter),
  };
}

/**
 * The challenge check: one named opposite-side receipt either proves a
 * claimed segment was opposed at request time, or the challenge fails. The
 * named receipt's `segments` are its recorded coverage — live support plus
 * its own pending-claimed segments. Never throws — a failed refutation is an
 * answer, not an error.
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

/** Lifecycle of a pending withdrawal request. */
export type WithdrawalRequestState = "pending" | "challenged" | "finalized";

/** One stored request: the stamped claim plus its window and payout. */
export type PendingWithdrawalRequest = {
  claim: WithdrawalClaim;
  /** Challenge deadline stamped at request time (ADR 0010's pattern). */
  deadline: bigint;
  refund: bigint;
  state: WithdrawalRequestState;
};

/**
 * The stateful pending-request machinery a contract would run, over one
 * market's receipts: request removes claimed segments from live support and
 * stamps the record, challenge refutes and restores, finalize pays after the
 * window. Time is the caller's `now` and must not run backwards, mirroring
 * block timestamps.
 */
export class WithdrawalRequestModel {
  readonly #challengeWindow: bigint;
  readonly #liquidityParameter: bigint;
  readonly #marketId: bigint;
  #nextReceiptId = 1n;
  #lastRequestAt = 0n;
  #lastDeadline = 0n;
  readonly #receipts = new Map<bigint, SegmentedReceipt>();
  readonly #requests: PendingWithdrawalRequest[] = [];

  constructor({
    challengeWindow,
    liquidityParameter,
    marketId,
  }: {
    challengeWindow: bigint;
    liquidityParameter: bigint;
    marketId: bigint;
  }) {
    this.#challengeWindow = challengeWindow;
    this.#liquidityParameter = liquidityParameter;
    this.#marketId = marketId;
  }

  /** Mirrors `placeReceipt`: allocates the next global id. */
  addReceipt({ segments, side }: { segments: PathSegment[]; side: number }): bigint {
    const receiptId = this.#nextReceiptId;
    this.#nextReceiptId += 1n;
    this.#receipts.set(receiptId, {
      active: true,
      marketId: this.#marketId,
      receiptId,
      segments: normalizePathSegments(segments),
      side,
    });
    return receiptId;
  }

  /** The receipt's live support (claimed pending segments already removed). */
  liveSegments(receiptId: bigint): PathSegment[] {
    return this.#receipt(receiptId).segments.map((segment) => ({ ...segment }));
  }

  /**
   * The refutation coverage of a receipt: live support plus the claimed
   * segments of its own still-pending requests, which stay recorded until
   * finalization.
   */
  recordedSegments(receiptId: bigint): PathSegment[] {
    const pendingClaims = this.#requests
      .filter((request) => request.state === "pending" && request.claim.receiptId === receiptId)
      .flatMap((request) => request.claim.segments);
    return normalizePathSegments([...this.#receipt(receiptId).segments, ...pendingClaims]);
  }

  request(requestId: number): PendingWithdrawalRequest {
    const stored = this.#requests[requestId];
    if (stored === undefined) throw new Error(`Unknown request ${requestId}.`);
    return stored;
  }

  /**
   * Structural verification only, then the state change: the claimed
   * segments leave live support now, the refund waits for the window. The
   * snapshot and the deadline are stamped here — the requester supplies
   * neither.
   */
  requestWithdrawal(receiptId: bigint, segments: PathSegment[], now: bigint): number {
    if (now < this.#lastRequestAt) {
      throw new Error("Time ran backwards.");
    }
    const receipt = this.#receipt(receiptId);
    const { refund } = verifyWithdrawalRequest({
      liquidityParameter: this.#liquidityParameter,
      receipt,
      request: { receiptId, segments },
    });

    const deadline = now + this.#challengeWindow;
    // Load-bearing for the collusion defense: a dependent claim's deadline
    // never precedes the enabling claim's, so it cannot finalize while the
    // enabling claim is still challengeable.
    if (deadline < this.#lastDeadline) {
      throw new Error("Challenge deadline ordering violated.");
    }
    this.#lastRequestAt = now;
    this.#lastDeadline = deadline;

    receipt.segments = splitOpposedFree(receipt.segments, segments).free;
    this.#requests.push({
      claim: {
        marketId: this.#marketId,
        nextReceiptIdSnapshot: this.#nextReceiptId,
        receiptId,
        segments: normalizePathSegments(segments),
      },
      deadline,
      refund,
      state: "pending",
    });
    return this.#requests.length - 1;
  }

  /**
   * Strictly inside the window only. A successful refutation cancels the
   * request and restores its segments to the claimant's live support.
   */
  challenge(requestId: number, refuterReceiptId: bigint, now: bigint): WithdrawalChallengeResult {
    const stored = this.request(requestId);
    if (stored.state !== "pending") {
      throw new Error(`Request ${requestId} is ${stored.state}.`);
    }
    if (now >= stored.deadline) {
      throw new Error("Challenge window closed.");
    }

    const refuter = this.#receipt(refuterReceiptId);
    const result = refuteWithdrawalClaim({
      claim: stored.claim,
      claimantSide: this.#receipt(stored.claim.receiptId).side,
      namedReceipt: { ...refuter, segments: this.recordedSegments(refuterReceiptId) },
    });
    if (!result.refuted) return result;

    stored.state = "challenged";
    const claimant = this.#receipt(stored.claim.receiptId);
    claimant.segments = normalizePathSegments([...claimant.segments, ...stored.claim.segments]);
    return result;
  }

  /** Pays the refund once the window has fully elapsed. */
  finalize(requestId: number, now: bigint): bigint {
    const stored = this.request(requestId);
    if (stored.state !== "pending") {
      throw new Error(`Request ${requestId} is ${stored.state}.`);
    }
    if (now < stored.deadline) {
      throw new Error("Request is before its challenge deadline.");
    }
    stored.state = "finalized";
    return stored.refund;
  }

  #receipt(receiptId: bigint): SegmentedReceipt {
    const receipt = this.#receipts.get(receiptId);
    if (receipt === undefined) throw new Error(`Unknown receipt ${receiptId}.`);
    return receipt;
  }
}

/**
 * ABI-encoded calldata size of `requestWithdrawal(uint256 receiptId,
 * (int256,int256)[] segments)`: selector, receiptId word, dynamic-array
 * offset and length words, then two words per segment. The snapshot and the
 * deadline are storage stamped at request time, not calldata.
 */
export function withdrawalRequestCalldataBytes(segmentCount: number): number {
  return 4 + 32 + 32 + 32 + segmentCount * 64;
}

/**
 * ABI-encoded calldata size of `challengeWithdrawal(uint256 requestId,
 * uint256 counterexampleReceiptId)`: selector plus two words.
 */
export function withdrawalChallengeCalldataBytes(): number {
  return 4 + 32 + 32;
}
