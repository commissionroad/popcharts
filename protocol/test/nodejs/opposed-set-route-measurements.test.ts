import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LiveCoverageUnion,
  MonotoneCoverageUnion,
  type CoverageWriteCosts,
} from "../../src/clearing/coverage-union.js";
import {
  segmentsSidePathCost,
  segmentsWidth,
  splitOpposedFree,
  type PathSegment,
} from "../../src/clearing/opposed-set.js";
import {
  refuteWithdrawalClaim,
  verifyWithdrawalRequest,
  withdrawalRequestCalldataBytes,
} from "../../src/clearing/withdrawal-claim.js";
import { SIDE_NO, SIDE_YES } from "../../src/market-side.js";
import {
  makeRng,
  walkPlacements,
  WAD,
  WALK_LIQUIDITY_PARAMETER,
} from "./opposed-set-walk-fixtures.js";

/**
 * ADR 0014 P3 spike harness: measures both opposed-set routes over the same
 * 398 seeded random walk books, with withdrawals interleaved so the two
 * route-1 union variants can diverge. Integer-geometry results (fragment and
 * record counts, widths) are pinned exactly — the generator is
 * platform-deterministic — while cost-valued results carry a small tolerance
 * because band costs run through float weighting.
 *
 * Set OPPOSED_SET_MEASUREMENTS=1 to print the full summary the spike report
 * quotes.
 */

const B = WALK_LIQUIDITY_PARAMETER;
const BOOKS = 398;
const WITHDRAW_PROBABILITY = 0.15;

type SimReceipt = {
  cost: bigint;
  receiptId: bigint;
  segments: PathSegment[];
  side: number;
};

type Distribution = {
  max: number;
  mean: number;
  p50: number;
  p95: number;
};

function distributionOf(samples: number[]): Distribution {
  if (samples.length === 0) return { max: 0, mean: 0, p50: 0, p95: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return {
    max: sorted[sorted.length - 1]!,
    mean: sorted.reduce((s, v) => s + v, 0) / sorted.length,
    p50: at(0.5),
    p95: at(0.95),
  };
}

function recordsTouched(costs: CoverageWriteCosts): number {
  return costs.recordsCreated + costs.recordsDeleted + costs.recordsRewritten;
}

function spanOf(segments: readonly PathSegment[]): PathSegment {
  return { rHigh: segments[segments.length - 1]!.rHigh, rLow: segments[0]!.rLow };
}

describe("opposed-set route measurements (ADR 0014 P3 spike)", () => {
  it("measures both routes over 398 random walk books with withdrawals", () => {
    const rng = makeRng(0x0014_0503);

    const monotoneInsertTouches: number[] = [];
    const liveInsertTouches: number[] = [];
    const monotoneWithdrawalReads: number[] = [];
    const liveWithdrawalReads: number[] = [];
    const monotoneFragmentCounts: number[] = [];
    const liveFragmentCounts: number[] = [];
    const liveBoundaryCounts: number[] = [];
    const claimSegmentCounts: number[] = [];
    const claimCalldataBytes: number[] = [];
    const refuteComparisons: number[] = [];

    let withdrawalsPerformed = 0;
    let withdrawnCost = 0n;
    let totalPlacedCost = 0n;
    let liveEscrowAtFreeze = 0n;
    let freeCostAtFreeze = 0n;
    let overLockedCost = 0n;
    let overLockedWidth = 0n;
    let booksWithOverLock = 0;

    for (let trial = 0; trial < BOOKS; trial += 1) {
      const placements = walkPlacements(rng, 4 + Math.floor(rng() * 37));
      const receipts: SimReceipt[] = [];
      const monotone = [new MonotoneCoverageUnion(), new MonotoneCoverageUnion()] as const;
      const live = [new LiveCoverageUnion(), new LiveCoverageUnion()] as const;

      for (const placement of placements) {
        const segment: PathSegment = { rHigh: placement.rHigh, rLow: placement.rLow };
        monotoneInsertTouches.push(recordsTouched(monotone[placement.side]!.insert(segment)));
        liveInsertTouches.push(recordsTouched(live[placement.side]!.insert(segment)));
        receipts.push({
          cost: placement.cost,
          receiptId: placement.sequence,
          segments: [segment],
          side: placement.side,
        });
        totalPlacedCost += placement.cost;

        if (rng() >= WITHDRAW_PROBABILITY) continue;
        const candidate = receipts[Math.floor(rng() * receipts.length)]!;
        if (candidate.segments.length === 0) continue;

        const oppositeSide = candidate.side === SIDE_YES ? SIDE_NO : SIDE_YES;
        const split = splitOpposedFree(candidate.segments, live[oppositeSide]!.union());
        if (split.free.length === 0) continue;

        const span = spanOf(candidate.segments);
        monotoneWithdrawalReads.push(monotone[oppositeSide]!.fragmentsOverlapping(span));
        liveWithdrawalReads.push(live[oppositeSide]!.boundariesNotAfter(span.rHigh));

        // Route 2 over the same withdrawal: verify the honest claim, and
        // refute the fraudulent complement (the opposed set) by naming a
        // covering opposite-side receipt, as an on-chain challenger would.
        verifyWithdrawalRequest({
          liquidityParameter: B,
          receipt: {
            active: true,
            marketId: 1n,
            receiptId: candidate.receiptId,
            segments: candidate.segments,
            side: candidate.side,
          },
          request: { receiptId: candidate.receiptId, segments: split.free },
        });
        claimSegmentCounts.push(split.free.length);
        claimCalldataBytes.push(withdrawalRequestCalldataBytes(split.free.length));

        if (split.opposed.length > 0) {
          // The stored claim record as the contract would stamp it: the
          // snapshot is the book's nextReceiptId at request time, never a
          // caller input.
          const fraud = {
            marketId: 1n,
            nextReceiptIdSnapshot: BigInt(receipts.length + 1),
            receiptId: candidate.receiptId,
            segments: split.opposed,
          };
          const counterexample = receipts.find(
            (other) =>
              other.side === oppositeSide &&
              splitOpposedFree(split.opposed, other.segments).opposed.length > 0,
          )!;
          const refutation = refuteWithdrawalClaim({
            claim: fraud,
            claimantSide: candidate.side,
            namedReceipt: {
              active: true,
              marketId: 1n,
              receiptId: counterexample.receiptId,
              segments: counterexample.segments,
              side: counterexample.side,
            },
          });
          assert.equal(refutation.refuted, true);
          refuteComparisons.push(refutation.comparisons);
        }

        for (const fragment of split.free) {
          live[candidate.side]!.remove(fragment);
        }
        withdrawnCost += segmentsSidePathCost(split.free, candidate.side, B);
        candidate.segments = split.opposed;
        withdrawalsPerformed += 1;
      }

      let bookOverLocked = 0n;
      for (const receipt of receipts) {
        if (receipt.segments.length === 0) continue;
        const oppositeSide = receipt.side === SIDE_YES ? SIDE_NO : SIDE_YES;
        const exact = splitOpposedFree(receipt.segments, live[oppositeSide]!.union());
        const stale = splitOpposedFree(receipt.segments, monotone[oppositeSide]!.fragments());

        const lockedExact = segmentsSidePathCost(exact.opposed, receipt.side, B);
        const lockedStale = segmentsSidePathCost(stale.opposed, receipt.side, B);
        assert.ok(lockedStale >= lockedExact);

        liveEscrowAtFreeze += segmentsSidePathCost(receipt.segments, receipt.side, B);
        freeCostAtFreeze += segmentsSidePathCost(exact.free, receipt.side, B);
        overLockedCost += lockedStale - lockedExact;
        bookOverLocked += lockedStale - lockedExact;
        overLockedWidth += segmentsWidth(stale.opposed) - segmentsWidth(exact.opposed);
      }
      if (bookOverLocked > 0n) booksWithOverLock += 1;

      for (const side of [SIDE_YES, SIDE_NO]) {
        monotoneFragmentCounts.push(monotone[side]!.fragmentCount);
        liveFragmentCounts.push(live[side]!.union().length);
        liveBoundaryCounts.push(live[side]!.boundaryCount);
      }
    }

    const summary = {
      claimCalldataBytes: distributionOf(claimCalldataBytes),
      claimSegments: distributionOf(claimSegmentCounts),
      freeCostAtFreeze,
      liveBoundaries: distributionOf(liveBoundaryCounts),
      liveEscrowAtFreeze,
      liveFragments: distributionOf(liveFragmentCounts),
      liveInsertTouches: distributionOf(liveInsertTouches),
      liveWithdrawalReads: distributionOf(liveWithdrawalReads),
      monotoneFragments: distributionOf(monotoneFragmentCounts),
      monotoneInsertTouches: distributionOf(monotoneInsertTouches),
      monotoneWithdrawalReads: distributionOf(monotoneWithdrawalReads),
      booksWithOverLock,
      overLockedCost,
      overLockedWidth,
      refuteComparisons: distributionOf(refuteComparisons),
      totalPlacedCost,
      withdrawalsPerformed,
      withdrawnCost,
    };
    if (process.env.OPPOSED_SET_MEASUREMENTS === "1") {
      console.log(
        JSON.stringify(summary, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2),
      );
    }

    // Pinned measurements under the fixed seed. Integer geometry is exact;
    // cost-valued numbers assert in basis points with a small band because
    // band costs run through float weighting.
    assert.equal(withdrawalsPerformed, 356);

    // Route 1 state and write costs. The monotone union stays tiny under
    // organic flow (p95: 3 fragments per side) and a placement touches at
    // most 3 records; the delta list pays exactly 2 record writes per
    // placement but accumulates boundary records (max here: 27 per side).
    assert.equal(summary.monotoneFragments.max, 6);
    assert.equal(summary.monotoneFragments.p95, 3);
    assert.equal(summary.monotoneInsertTouches.max, 3);
    assert.equal(summary.liveInsertTouches.max, 2);
    assert.equal(summary.liveInsertTouches.p50, 2);
    assert.equal(summary.liveFragments.max, 6);
    assert.equal(summary.liveBoundaries.max, 27);

    // Withdrawal-time reads: intersecting against merged fragments stays at
    // or under 2 here; the delta list's prefix walk reaches 20 records.
    assert.equal(summary.monotoneWithdrawalReads.max, 2);
    assert.equal(summary.liveWithdrawalReads.max, 20);

    // Route 1a over-locking: escrow the monotone union reports locked while
    // the exact live union frees it. 80 of 398 books diverge; 35 bp of live
    // escrow at freeze, ~3% of the truly free set. Width is integer-exact.
    assert.equal(booksWithOverLock, 80);
    assert.equal(overLockedWidth, 1_681_738_700_000_000_000_000n);
    const overLockedBps = (overLockedCost * 10_000n) / liveEscrowAtFreeze;
    assert.ok(overLockedBps >= 33n && overLockedBps <= 38n);

    // Withdrawable escrow overall (withdrawn plus still-free at freeze):
    // ~14.9% of everything placed — the ADR's "~15% of escrow becomes
    // withdrawable" measured independently by this generator.
    const withdrawableBps = ((withdrawnCost + freeCostAtFreeze) * 10_000n) / totalPlacedCost;
    assert.ok(withdrawableBps >= 1_450n && withdrawableBps <= 1_520n);

    // Route 2 stays flat: organic claims are 1–2 segments (164–228 bytes of
    // calldata), and a refutation runs ~5 comparisons over one named receipt.
    assert.equal(summary.claimSegments.max, 2);
    assert.equal(summary.claimCalldataBytes.max, 228);
    assert.equal(summary.refuteComparisons.max, 6);
  });

  it("route 1 adversarial: a walk-realizable alternating book fragments the union O(n)", () => {
    // The attacker alternates a YES dust buy with a NO descent that walks
    // past it, so consecutive YES intervals never touch: each cycle leaves
    // one more permanent YES fragment. Every interval starts at the current
    // path coordinate — this is a legal trade sequence, not a synthetic one.
    const cycles = 64;
    const dust = WAD / 10n;
    const descent = 3n * dust;
    const monotoneYes = new MonotoneCoverageUnion();
    const liveYes = new LiveCoverageUnion();
    const monotoneNo = new MonotoneCoverageUnion();

    let path = 0n;
    for (let i = 0; i < cycles; i += 1) {
      monotoneYes.insert({ rHigh: path + dust, rLow: path });
      liveYes.insert({ rHigh: path + dust, rLow: path });
      path += dust;
      monotoneNo.insert({ rHigh: path, rLow: path - descent });
      path -= descent;
    }

    assert.equal(monotoneYes.fragmentCount, cycles);
    assert.equal(liveYes.boundaryCount, 2 * cycles);
    // The NO descent is contiguous, so the attacker's own side stays merged.
    assert.equal(monotoneNo.fragmentCount, 1);

    // A NO withdrawal over the walked range must read every YES fragment
    // (route 1a) or every YES boundary (route 1b) to find its opposed set.
    const sweep = { rHigh: BigInt(cycles) * dust, rLow: path };
    assert.equal(monotoneYes.fragmentsOverlapping(sweep), cycles);
    assert.equal(liveYes.boundariesNotAfter(sweep.rHigh), 2 * cycles);

    // The next honest YES buy spanning the walked range pays the merge: one
    // insert clears all but one fragment record.
    const mergeCosts = monotoneYes.insert(sweep);
    assert.deepEqual(mergeCosts, {
      recordsCreated: 0,
      recordsDeleted: cycles - 1,
      recordsRewritten: 1,
    });
  });

  it("route 1a adversarial: place-and-withdraw poisons the monotone union", () => {
    // The poisoner walks YES across a range nobody opposes, withdraws every
    // band (all free — Lemma 3 makes this refund exact), and leaves the
    // monotone YES union covering the range forever. Every later NO receipt
    // inside it reads fully locked; the exact live union frees it all.
    const monotoneYes = new MonotoneCoverageUnion();
    const liveYes = new LiveCoverageUnion();
    const poisoned: PathSegment = { rHigh: 100n * WAD, rLow: -100n * WAD };

    monotoneYes.insert(poisoned);
    liveYes.insert(poisoned);
    liveYes.remove(poisoned); // the withdrawal; the monotone union cannot shrink

    const victim: PathSegment = { rHigh: 40n * WAD, rLow: -40n * WAD };
    const stale = splitOpposedFree([victim], monotoneYes.fragments());
    const exact = splitOpposedFree([victim], liveYes.union());

    assert.deepEqual(stale.free, []);
    assert.deepEqual(stale.opposed, [victim]);
    assert.deepEqual(exact.opposed, []);
    assert.deepEqual(exact.free, [victim]);

    // Price of the grief: the withdrawal fee on the poisoner's path cost
    // (φ_out = 5%, ADR 0014 §3) — principal refunds in full. The victim
    // escrow denied withdrawal is unbounded in the poisoned range.
    const poisonerCost = segmentsSidePathCost([poisoned], SIDE_YES, B);
    const victimEscrow = segmentsSidePathCost([victim], SIDE_NO, B);
    const feePaid = (poisonerCost * 5n) / 100n;
    assert.ok(feePaid < victimEscrow);
  });
});
