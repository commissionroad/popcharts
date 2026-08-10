import { yesBandCost, type ClearingReceipt } from "../../src/clearing/band-pass-clearing.js";
import { SIDE_NO, SIDE_YES } from "../../src/market-side.js";

/**
 * Seeded random receipt books for the ADR 0014 opposed-set spike, generated
 * by the whitepaper's trade model (v0.6 §4): trades act in sequence on one
 * path coordinate, a YES buy of width w sweeps [r, r + w] and advances the
 * path, a NO buy sweeps [r − w, r] and retreats it. Interval structure
 * therefore comes from the walk, not from independently placed intervals —
 * the repo had no generator for the ADR's "398 random books" simulation, so
 * this file is that generator, written for the spike.
 *
 * All geometry is integer WAD arithmetic on micro-b units, so books are
 * platform-deterministic and integer-valued measurements can be pinned
 * exactly. Costs go through the clearing sweep's float-weighted band cost
 * and stay deterministic per platform, but cost-valued assertions should
 * carry a tolerance.
 */

export const WAD = 10n ** 18n;

/** Liquidity parameter shared by every generated book (b = 100, in WAD). */
export const WALK_LIQUIDITY_PARAMETER = 100n * WAD;

const MICRO_B = WALK_LIQUIDITY_PARAMETER / 1_000_000n;

/**
 * Deterministic PRNG (mulberry32), the same convention the server keeper
 * clearing suite uses for its property runs.
 */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One placement produced by the walk, in book order. */
export type WalkPlacement = {
  cost: bigint;
  rHigh: bigint;
  rLow: bigint;
  sequence: bigint;
  side: number;
};

/**
 * Generates `count` sequential placements: an opening coordinate uniform in
 * [−2b, 2b] (prices roughly 12%–88%), then per trade a fair-coin side and a
 * width uniform in [0.05b, 0.75b] — the scale of the whitepaper's worked
 * example, where widths are 0.2b–1.0b.
 */
export function walkPlacements(rng: () => number, count: number): WalkPlacement[] {
  let path = BigInt(Math.round((rng() * 4 - 2) * 1_000_000)) * MICRO_B;
  const placements: WalkPlacement[] = [];
  for (let i = 0; i < count; i += 1) {
    const side = rng() < 0.5 ? SIDE_YES : SIDE_NO;
    const width = BigInt(Math.round((0.05 + rng() * 0.7) * 1_000_000)) * MICRO_B;
    const rLow = side === SIDE_YES ? path : path - width;
    const rHigh = rLow + width;
    const yesCost = yesBandCost(rLow, rHigh, WALK_LIQUIDITY_PARAMETER);
    placements.push({
      cost: side === SIDE_YES ? yesCost : width - yesCost,
      rHigh,
      rLow,
      sequence: BigInt(i + 1),
      side,
    });
    path = side === SIDE_YES ? rHigh : rLow;
  }
  return placements;
}

/** A walk book in the clearing sweep's receipt shape. */
export function randomWalkBook(rng: () => number, count: number): ClearingReceipt[] {
  return walkPlacements(rng, count).map((placement) => ({
    cost: placement.cost,
    marketId: 1n,
    owner: "0x0000000000000000000000000000000000000001",
    receiptId: placement.sequence,
    rHigh: placement.rHigh,
    rLow: placement.rLow,
    sequence: placement.sequence,
    shares: placement.rHigh - placement.rLow,
    side: placement.side,
  }));
}
