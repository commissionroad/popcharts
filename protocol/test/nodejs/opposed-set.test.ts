import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeBandPassClearing,
  computeMatchedMarketCap,
  yesBandCost,
  type ClearingReceipt,
} from "../../src/clearing/band-pass-clearing.js";
import {
  normalizePathSegments,
  segmentSidePathCost,
  segmentsSidePathCost,
  segmentsWidth,
  splitOpposedFree,
  type PathSegment,
} from "../../src/clearing/opposed-set.js";
import { SIDE_NO, SIDE_YES } from "../../src/market-side.js";
import {
  makeRng,
  randomWalkBook,
  WAD,
  WALK_LIQUIDITY_PARAMETER,
} from "./opposed-set-walk-fixtures.js";

const B = WALK_LIQUIDITY_PARAMETER;
const CENT = WAD / 100n; // tolerance for the whitepaper's 4-decimal figures

/** r(P) = b·ln(P/(1−P)) in WAD, for P given as a percent (20 => 20%). */
function rOfPercent(percent: number): bigint {
  const p = percent / 100;
  return BigInt(Math.round(Number(B) * Math.log(p / (1 - p))));
}

function absDiff(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a;
}

describe("splitOpposedFree — whitepaper Example A (ADR 0014 P2 golden)", () => {
  // b=100, open 20%. Alice YES 20→40, Noah NO 40→30, Bea YES 30→35.
  const r20 = rOfPercent(20);
  const r30 = rOfPercent(30);
  const r35 = rOfPercent(35);
  const r40 = rOfPercent(40);

  const aliceSegments: PathSegment[] = [{ rHigh: r40, rLow: r20 }];
  const yesCoverage: PathSegment[] = [
    { rHigh: r40, rLow: r20 },
    { rHigh: r35, rLow: r30 },
  ];
  const noCoverage: PathSegment[] = [{ rHigh: r40, rLow: r30 }];

  it("Alice: 44.18 locked, 53.90 free, 13.35 of 28.77 recoverable", () => {
    const split = splitOpposedFree(aliceSegments, noCoverage);

    assert.deepEqual(split.opposed, [{ rHigh: r40, rLow: r30 }]);
    assert.deepEqual(split.free, [{ rHigh: r30, rLow: r20 }]);
    assert.ok(absDiff(segmentsWidth(split.opposed), 4418n * CENT) < CENT);
    assert.ok(absDiff(segmentsWidth(split.free), 5390n * CENT) < CENT);

    const aliceCost = yesBandCost(r20, r40, B);
    const freeCost = segmentsSidePathCost(split.free, SIDE_YES, B);
    const opposedCost = segmentsSidePathCost(split.opposed, SIDE_YES, B);
    assert.ok(absDiff(aliceCost, 2877n * CENT) < CENT);
    assert.ok(absDiff(freeCost, 1335n * CENT) < CENT);
    // Band costs are additive at a shared split point, so the free/opposed
    // partition conserves the recorded cost to the wei. The net-of-fee payout
    // (12.6825 at φ_out = 5%) is P2's quoteWithdrawal, deliberately not here.
    assert.equal(freeCost + opposedCost, aliceCost);
  });

  it("Noah and Bea are fully locked", () => {
    const noah = splitOpposedFree([{ rHigh: r40, rLow: r30 }], yesCoverage);
    assert.deepEqual(noah.free, []);
    assert.deepEqual(noah.opposed, [{ rHigh: r40, rLow: r30 }]);

    const bea = splitOpposedFree([{ rHigh: r35, rLow: r30 }], noCoverage);
    assert.deepEqual(bea.free, []);
    assert.deepEqual(bea.opposed, [{ rHigh: r35, rLow: r30 }]);
  });
});

describe("splitOpposedFree — interval mechanics", () => {
  it("an interior opposition splits a segment into two free fragments", () => {
    const split = splitOpposedFree([{ rHigh: 10n, rLow: 0n }], [{ rHigh: 6n, rLow: 4n }]);
    assert.deepEqual(split.opposed, [{ rHigh: 6n, rLow: 4n }]);
    assert.deepEqual(split.free, [
      { rHigh: 4n, rLow: 0n },
      { rHigh: 10n, rLow: 6n },
    ]);
  });

  it("touching at an endpoint is not opposition — no band is shared", () => {
    const split = splitOpposedFree(
      [{ rHigh: 10n, rLow: 0n }],
      [
        { rHigh: 0n, rLow: -5n },
        { rHigh: 15n, rLow: 10n },
      ],
    );
    assert.deepEqual(split.opposed, []);
    assert.deepEqual(split.free, [{ rHigh: 10n, rLow: 0n }]);
  });

  it("normalizes input: merges touching coverage and drops zero-width segments", () => {
    assert.deepEqual(
      normalizePathSegments([
        { rHigh: 4n, rLow: 2n },
        { rHigh: 2n, rLow: 0n },
        { rHigh: 3n, rLow: 3n },
        { rHigh: 9n, rLow: 7n },
      ]),
      [
        { rHigh: 4n, rLow: 0n },
        { rHigh: 9n, rLow: 7n },
      ],
    );
    assert.throws(() => normalizePathSegments([{ rHigh: 0n, rLow: 1n }]), /Inverted/);
  });

  it("splits NO-side cost as the exact width complement of YES cost", () => {
    const segment: PathSegment = { rHigh: 30n * WAD, rLow: 10n * WAD };
    const yes = segmentSidePathCost(segment, SIDE_YES, B);
    const no = segmentSidePathCost(segment, SIDE_NO, B);
    assert.equal(yes + no, segment.rHigh - segment.rLow);
  });
});

describe("splitOpposedFree — Lemma 3 over 398 random walk books", () => {
  it("withdrawing every free band of every receipt leaves F bit-identical", () => {
    const rng = makeRng(0x0014_03);
    let booksWithOverlap = 0;
    let maxOpposedFragments = 0;

    for (let trial = 0; trial < 398; trial += 1) {
      const book = randomWalkBook(rng, 4 + Math.floor(rng() * 37));
      const plan = computeBandPassClearing({
        graduationThreshold: 0n,
        liquidityParameter: B,
        receipts: book,
      });

      const coverage = (side: number): PathSegment[] =>
        normalizePathSegments(
          book
            .filter((receipt) => receipt.side === side)
            .map((receipt) => ({ rHigh: receipt.rHigh, rLow: receipt.rLow })),
        );
      const unions = [coverage(SIDE_YES), coverage(SIDE_NO)] as const;

      // The frozen book minus every free band: each receipt keeps only its
      // opposed fragments, each fragment a row at its own recorded path cost.
      const reduced: ClearingReceipt[] = [];
      for (const receipt of book) {
        const opposite = unions[receipt.side === SIDE_YES ? SIDE_NO : SIDE_YES];
        const split = splitOpposedFree([{ rHigh: receipt.rHigh, rLow: receipt.rLow }], opposite);
        for (const free of split.free) {
          assert.deepEqual(splitOpposedFree([free], opposite).opposed, []);
        }
        maxOpposedFragments = Math.max(maxOpposedFragments, split.opposed.length);
        for (const fragment of split.opposed) {
          const id = BigInt(reduced.length + 1);
          reduced.push({
            cost: segmentSidePathCost(fragment, receipt.side, B),
            marketId: receipt.marketId,
            owner: receipt.owner,
            receiptId: id,
            rHigh: fragment.rHigh,
            rLow: fragment.rLow,
            sequence: id,
            shares: fragment.rHigh - fragment.rLow,
            side: receipt.side,
          });
        }
      }

      if (reduced.length === 0) {
        assert.equal(plan.matchedMarketCap, 0n);
        continue;
      }
      booksWithOverlap += 1;

      const reducedPlan = computeBandPassClearing({
        graduationThreshold: 0n,
        liquidityParameter: B,
        receipts: reduced,
      });
      assert.equal(reducedPlan.matchedMarketCap, plan.matchedMarketCap);
      assert.equal(computeMatchedMarketCap(reduced), plan.matchedMarketCap);
    }

    // Pinned under the fixed seed: the property must have been exercised on
    // real overlap, not vacuously on empty reduced books (the other 4 books
    // are single-sided and clear to F = 0).
    assert.equal(booksWithOverlap, 394);
    assert.ok(maxOpposedFragments >= 2);
  });
});
