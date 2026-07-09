import { describe, expect, it } from "bun:test";

import { calculateMatchedMarketCap } from "src/api/services/matched-market-cap";

import {
  computeBandPassClearing,
  SIDE_NO,
  SIDE_YES,
  yesBandCost,
  type ClearingReceipt,
} from "@popcharts/protocol";

const WAD = 10n ** 18n;
const B = 100n * WAD; // liquidity parameter b = 100

/** r(P) = b·ln(P/(1−P)) in WAD, for P given as a percent (20 => 20%). */
function rOfPercent(percent: number): bigint {
  const p = percent / 100;
  return BigInt(Math.round(Number(B) * Math.log(p / (1 - p))));
}

function receipt(
  overrides: Partial<ClearingReceipt> & {
    rHigh: bigint;
    rLow: bigint;
    side: number;
  },
): ClearingReceipt {
  const shares = overrides.rHigh - overrides.rLow;
  const cost =
    overrides.side === SIDE_YES
      ? yesBandCost(overrides.rLow, overrides.rHigh, B)
      : shares - yesBandCost(overrides.rLow, overrides.rHigh, B);
  return {
    cost,
    marketId: 1n,
    owner: "0x0000000000000000000000000000000000000001",
    receiptId: 1n,
    sequence: 1n,
    shares,
    ...overrides,
  };
}

/** Absolute bigint difference, for whitepaper cross-checks with tolerance. */
function absDiff(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a;
}

const CENT = WAD / 100n; // 0.01 WAD tolerance for 4-decimal whitepaper figures

describe("computeBandPassClearing — whitepaper Example A", () => {
  // b=100, open 20%. Alice YES 20→40, Noah NO 40→30, Bea YES 30→35. Threshold 40.
  const r20 = rOfPercent(20);
  const r30 = rOfPercent(30);
  const r35 = rOfPercent(35);
  const r40 = rOfPercent(40);

  const alice = receipt({
    rLow: r20,
    rHigh: r40,
    side: SIDE_YES,
    receiptId: 1n,
    sequence: 1n,
  });
  const noah = receipt({
    rLow: r30,
    rHigh: r40,
    side: SIDE_NO,
    receiptId: 2n,
    sequence: 2n,
  });
  const bea = receipt({
    rLow: r30,
    rHigh: r35,
    side: SIDE_YES,
    receiptId: 3n,
    sequence: 3n,
  });

  const plan = computeBandPassClearing({
    graduationThreshold: 40n * WAD,
    liquidityParameter: B,
    receipts: [alice, noah, bea],
  });
  const byId = new Map(plan.claims.map((c) => [c.receiptId, c]));

  it("graduates: only the two two-sided bands match (the 20–30 band is one-sided)", () => {
    expect(plan.graduates).toBe(true);
    // Matched cap is Noah's fully-overlapped NO interval = width(30→40).
    expect(plan.matchedMarketCap).toBe(r40 - r30);
    // Cross-check the whitepaper's independently derived 44.1833.
    expect(
      absDiff(plan.matchedMarketCap, 4418n * CENT + 33n * (CENT / 100n)),
    ).toBeLessThan(CENT);
  });

  it("fully retains the scarce side (Noah), refunding nothing", () => {
    const claim = byId.get(2n)!;
    expect(claim.retainedShares).toBe(noah.shares);
    expect(claim.retainedCost).toBe(noah.cost);
    expect(claim.refund).toBe(0n);
  });

  it("prorates the crowded YES side 50/50 in the contested 30–35 band", () => {
    const aliceClaim = byId.get(1n)!;
    const beaClaim = byId.get(3n)!;
    const contested = r35 - r30; // width(30→35), split between Alice and Bea
    const clear = r40 - r35; // width(35→40), Alice alone with Noah

    // Alice keeps half the contested band plus all of the top band.
    expect(
      absDiff(aliceClaim.retainedShares, contested / 2n + clear),
    ).toBeLessThanOrEqual(1n);
    // Bea keeps half the contested band and nothing else.
    expect(
      absDiff(beaClaim.retainedShares, contested / 2n),
    ).toBeLessThanOrEqual(1n);
    // Their contested halves sum to the whole band — no shares invented or lost.
    expect(aliceClaim.retainedShares + beaClaim.retainedShares).toBe(
      contested + clear,
    );

    // Whitepaper: Alice 32.7704, Bea 11.4130 shares; Bea refund == retainedCost (3.7054).
    expect(
      absDiff(aliceClaim.retainedShares, 3277n * CENT + 4n * (CENT / 100n)),
    ).toBeLessThan(CENT);
    expect(
      absDiff(beaClaim.retainedShares, 1141n * CENT + 30n * (CENT / 100n)),
    ).toBeLessThan(CENT);
    expect(absDiff(beaClaim.refund, beaClaim.retainedCost)).toBeLessThanOrEqual(
      2n,
    );
  });

  it("conserves escrow and balances complete sets exactly", () => {
    expect(plan.retainedCostTotal).toBe(plan.matchedMarketCap);
    expect(plan.completeSetCount).toBe(plan.matchedMarketCap);
    expect(plan.retainedCostTotal + plan.refundTotal).toBe(plan.totalEscrowed);

    const yes = plan.claims
      .filter((c) => c.side === SIDE_YES)
      .reduce((s, c) => s + c.retainedShares, 0n);
    const no = plan.claims
      .filter((c) => c.side === SIDE_NO)
      .reduce((s, c) => s + c.retainedShares, 0n);
    expect(yes).toBe(no);
    expect(yes).toBe(plan.completeSetCount);
  });
});

describe("computeBandPassClearing — the eligibility bug the sweep fixes", () => {
  it("refuses a lopsided book that min(totalYes,totalNo) would graduate", () => {
    // YES demand parked low, NO demand parked high — no price band overlaps.
    const yesReceipt = receipt({
      rLow: 0n,
      rHigh: 10n * WAD,
      side: SIDE_YES,
      receiptId: 1n,
      sequence: 1n,
    });
    const noReceipt = receipt({
      rLow: 20n * WAD,
      rHigh: 30n * WAD,
      side: SIDE_NO,
      receiptId: 2n,
      sequence: 2n,
    });

    const plan = computeBandPassClearing({
      graduationThreshold: 1n * WAD,
      liquidityParameter: B,
      receipts: [yesReceipt, noReceipt],
    });

    // The real sweep: nothing matches, no graduation, full refunds.
    expect(plan.matchedMarketCap).toBe(0n);
    expect(plan.graduates).toBe(false);
    expect(plan.refundTotal).toBe(plan.totalEscrowed);
    for (const claim of plan.claims) expect(claim.retainedShares).toBe(0n);

    // The old shortcut would have said "graduate": min(totalYes, totalNo) > 0.
    const shortcut = calculateMatchedMarketCap({
      yesShares: yesReceipt.shares,
      noShares: noReceipt.shares,
    });
    expect(shortcut).toBeGreaterThan(0n);
    expect(shortcut).not.toBe(plan.matchedMarketCap);
  });
});

/** Deterministic PRNG (mulberry32) so property runs are reproducible. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBook(rng: () => number, count: number): ClearingReceipt[] {
  return Array.from({ length: count }, (_, i) => {
    const side = rng() < 0.5 ? SIDE_YES : SIDE_NO;
    // Coordinates in a small range so intervals overlap often.
    const rLow = BigInt(Math.round((rng() * 10 - 5) * Number(WAD)));
    const width = BigInt(Math.max(1, Math.round(rng() * 5 * Number(WAD))));
    return receipt({
      rLow,
      rHigh: rLow + width,
      side,
      receiptId: BigInt(i + 1),
      sequence: BigInt(i + 1),
    });
  });
}

describe("computeBandPassClearing — invariants over random books", () => {
  it("holds every conservation and balance invariant across 2000 random books", () => {
    const rng = makeRng(0xc0ffee);
    for (let trial = 0; trial < 2000; trial += 1) {
      const book = randomBook(rng, 1 + Math.floor(rng() * 8));
      // The function throws on any internal invariant violation; not throwing is
      // itself the assertion. We re-check the contract-facing ones explicitly.
      const plan = computeBandPassClearing({
        graduationThreshold: 0n,
        liquidityParameter: B,
        receipts: book,
      });

      expect(plan.retainedCostTotal).toBe(plan.matchedMarketCap);
      expect(plan.completeSetCount).toBe(plan.matchedMarketCap);
      expect(plan.retainedCostTotal + plan.refundTotal).toBe(
        plan.totalEscrowed,
      );
      expect(plan.matchedMarketCap).toBeGreaterThanOrEqual(0n);

      let yes = 0n;
      let no = 0n;
      for (const claim of plan.claims) {
        const source = book.find((r) => r.receiptId === claim.receiptId)!;
        expect(claim.retainedCost + claim.refund).toBe(source.cost);
        expect(claim.refund).toBeGreaterThanOrEqual(0n);
        expect(claim.retainedShares).toBeLessThanOrEqual(source.shares);
        expect(claim.retainedCost).toBeLessThanOrEqual(claim.retainedShares);
        if (claim.side === SIDE_YES) yes += claim.retainedShares;
        else no += claim.retainedShares;
      }
      expect(yes).toBe(no);
      expect(yes).toBe(plan.completeSetCount);
    }
  });

  it("is deterministic and independent of receipt ordering", () => {
    const rng = makeRng(0x1234);
    const book = randomBook(rng, 7);
    const shuffled = [...book].reverse();

    const a = computeBandPassClearing({
      graduationThreshold: 0n,
      liquidityParameter: B,
      receipts: book,
    });
    const b = computeBandPassClearing({
      graduationThreshold: 0n,
      liquidityParameter: B,
      receipts: book,
    });
    const c = computeBandPassClearing({
      graduationThreshold: 0n,
      liquidityParameter: B,
      receipts: shuffled,
    });

    // Byte-identical root on re-run.
    expect(b.merkleRoot).toBe(a.merkleRoot);
    // Order-independent economics: same matched cap and same per-receipt outcome.
    expect(c.matchedMarketCap).toBe(a.matchedMarketCap);
    const outcome = (plan: typeof a) =>
      new Map(
        plan.claims.map((x) => [
          x.receiptId,
          `${x.retainedShares}:${x.retainedCost}:${x.refund}`,
        ]),
      );
    expect(outcome(c)).toEqual(outcome(a));
  });
});
