import { SIDE_YES } from "../market-side.js";
import { yesBandCost } from "./band-pass-clearing.js";

/**
 * Opposed/free band split for pre-graduation receipts (ADR 0014 §1,
 * whitepaper v0.6 §4).
 *
 * A band of a receipt is opposed once any live opposite-side receipt covers
 * it; opposed bands stay locked until clearing, and every other band may be
 * withdrawn at that band's own recorded path cost. The split is pure interval
 * arithmetic: opposed = segments ∩ opposite-side coverage, free = the rest.
 * Opposition needs positive width — two intervals that only touch at an
 * endpoint share no band, so they do not oppose each other.
 *
 * Costs reuse the clearing sweep's band-cost function, which rounds once per
 * coordinate so band costs are additive. Splitting a segment at any shared
 * coordinate therefore conserves its cost exactly: free cost plus opposed
 * cost equals the segment's recorded cost to the wei.
 */

/** A closed interval [rLow, rHigh] on the LMSR path coordinate, in WAD. */
export type PathSegment = {
  rHigh: bigint;
  rLow: bigint;
};

/** Result of {@link splitOpposedFree}: disjoint lists that partition the input. */
export type OpposedFreeSplit = {
  /** Bands with no live opposite-side coverage — withdrawable (Lemma 3). */
  free: PathSegment[];
  /** Bands covered by live opposite-side receipts — locked until clearing. */
  opposed: PathSegment[];
};

/**
 * Sorts segments, drops zero-width ones, and merges any that overlap or
 * touch, returning the canonical minimal disjoint form. Throws on an
 * inverted segment — that is corrupt input, not an empty interval.
 */
export function normalizePathSegments(segments: readonly PathSegment[]): PathSegment[] {
  for (const segment of segments) {
    if (segment.rHigh < segment.rLow) {
      throw new Error(`Inverted path segment [${segment.rLow}, ${segment.rHigh}].`);
    }
  }

  const positive = segments.filter((segment) => segment.rHigh > segment.rLow);
  positive.sort((a, b) => (a.rLow < b.rLow ? -1 : a.rLow > b.rLow ? 1 : 0));

  const merged: PathSegment[] = [];
  for (const segment of positive) {
    const last = merged[merged.length - 1];
    if (last !== undefined && segment.rLow <= last.rHigh) {
      if (segment.rHigh > last.rHigh) last.rHigh = segment.rHigh;
      continue;
    }
    merged.push({ rHigh: segment.rHigh, rLow: segment.rLow });
  }
  return merged;
}

/**
 * Splits a receipt's live segments into the opposed part (positive-width
 * intersection with the opposite side's live coverage) and the free rest.
 * Both outputs are normalized, mutually disjoint, and together cover exactly
 * the input segments.
 */
export function splitOpposedFree(
  segments: readonly PathSegment[],
  oppositeCoverage: readonly PathSegment[],
): OpposedFreeSplit {
  const own = normalizePathSegments(segments);
  const opposite = normalizePathSegments(oppositeCoverage);

  const free: PathSegment[] = [];
  const opposed: PathSegment[] = [];

  for (const segment of own) {
    let cursor = segment.rLow;
    for (const cover of opposite) {
      if (cover.rHigh <= cursor) continue;
      if (cover.rLow >= segment.rHigh) break;

      const overlapLow = cover.rLow > cursor ? cover.rLow : cursor;
      const overlapHigh = cover.rHigh < segment.rHigh ? cover.rHigh : segment.rHigh;
      if (overlapLow > cursor) free.push({ rHigh: overlapLow, rLow: cursor });
      opposed.push({ rHigh: overlapHigh, rLow: overlapLow });
      cursor = overlapHigh;
    }
    if (cursor < segment.rHigh) free.push({ rHigh: segment.rHigh, rLow: cursor });
  }

  return { free, opposed };
}

/** Total width covered by a segment list, in WAD shares. */
export function segmentsWidth(segments: readonly PathSegment[]): bigint {
  return segments.reduce((sum, segment) => sum + (segment.rHigh - segment.rLow), 0n);
}

/**
 * The recorded path cost of one segment for the given side: the same
 * closed-form band cost clearing uses, so a withdrawal quote and the clearing
 * plan can never disagree about what a band cost.
 */
export function segmentSidePathCost(
  segment: PathSegment,
  side: number,
  liquidityParameter: bigint,
): bigint {
  const yesCost = yesBandCost(segment.rLow, segment.rHigh, liquidityParameter);
  return side === SIDE_YES ? yesCost : segment.rHigh - segment.rLow - yesCost;
}

/** Sum of {@link segmentSidePathCost} over a segment list. */
export function segmentsSidePathCost(
  segments: readonly PathSegment[],
  side: number,
  liquidityParameter: bigint,
): bigint {
  return segments.reduce(
    (sum, segment) => sum + segmentSidePathCost(segment, side, liquidityParameter),
    0n,
  );
}
