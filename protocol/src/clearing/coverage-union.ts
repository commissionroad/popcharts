import { normalizePathSegments, type PathSegment } from "./opposed-set.js";

/**
 * Route-1 prototypes for the ADR 0014 P3 opposed-set question: the
 * per-market per-side coverage structure a contract would maintain so a
 * withdrawal can compute its opposed set without iterating the opposite
 * side's receipts (there is no per-market receipt enumeration on chain).
 *
 * Two variants, measured against each other by the spike tests:
 *
 * - {@link MonotoneCoverageUnion} — ever-covered intervals, merged on insert,
 *   never shrunk. Sound, because a band only ever leaves the live book while
 *   unopposed, so everything this union frees is truly free. But a withdrawn
 *   interval's coverage stays behind forever and over-locks any receipt
 *   placed over the vacated region later.
 * - {@link LiveCoverageUnion} — exact live coverage as a sorted list of
 *   cover-count deltas (+1 at rLow, −1 at rHigh). Placement and withdrawal
 *   are two boundary-record writes each, but reading the union back is a
 *   prefix walk over every record at or left of the query span.
 *
 * Cost accounting counts storage records touched — the unit an on-chain
 * implementation pays SSTOREs and SLOADs for. One record is one fragment
 * (rLow, rHigh) or one boundary (coordinate, count): two words naturally,
 * one slot if packed to 128 bits per field.
 */

/** Storage records touched by one structure mutation. */
export type CoverageWriteCosts = {
  /** New records written to empty slots. */
  recordsCreated: number;
  /** Records cleared by a merge or a count reaching zero. */
  recordsDeleted: number;
  /** Existing records whose contents changed. */
  recordsRewritten: number;
};

function noWrites(): CoverageWriteCosts {
  return { recordsCreated: 0, recordsDeleted: 0, recordsRewritten: 0 };
}

/**
 * Sorted disjoint non-touching fragment list that only ever grows: the
 * "ever-opposed" union. `insert` merges the new interval into the run of
 * fragments it overlaps or touches.
 */
export class MonotoneCoverageUnion {
  #fragments: PathSegment[] = [];

  get fragmentCount(): number {
    return this.#fragments.length;
  }

  /** The covered intervals, sorted, disjoint, and non-touching. */
  fragments(): PathSegment[] {
    return this.#fragments.map((fragment) => ({ ...fragment }));
  }

  /**
   * Read-cost model for a withdrawal-time intersection: the fragments a
   * contract must load to intersect a receipt span with this union.
   */
  fragmentsOverlapping(span: PathSegment): number {
    return this.#fragments.filter(
      (fragment) => fragment.rHigh > span.rLow && fragment.rLow < span.rHigh,
    ).length;
  }

  insert(segment: PathSegment): CoverageWriteCosts {
    if (segment.rHigh < segment.rLow) {
      throw new Error(`Inverted path segment [${segment.rLow}, ${segment.rHigh}].`);
    }
    const costs = noWrites();
    if (segment.rHigh === segment.rLow) return costs;

    // The run of fragments that overlap or touch the inserted interval.
    let first = 0;
    while (first < this.#fragments.length && this.#fragments[first]!.rHigh < segment.rLow) {
      first += 1;
    }
    let last = first;
    while (last < this.#fragments.length && this.#fragments[last]!.rLow <= segment.rHigh) {
      last += 1;
    }

    if (first === last) {
      this.#fragments.splice(first, 0, { rHigh: segment.rHigh, rLow: segment.rLow });
      costs.recordsCreated = 1;
      return costs;
    }

    const runLow = this.#fragments[first]!.rLow;
    const runHigh = this.#fragments[last - 1]!.rHigh;
    const mergedLow = runLow < segment.rLow ? runLow : segment.rLow;
    const mergedHigh = runHigh > segment.rHigh ? runHigh : segment.rHigh;
    const contained = mergedLow === runLow && mergedHigh === runHigh && last - first === 1;

    this.#fragments.splice(first, last - first, { rHigh: mergedHigh, rLow: mergedLow });
    if (!contained) costs.recordsRewritten = 1;
    costs.recordsDeleted = last - first - 1;
    return costs;
  }
}

type CoverageBoundary = {
  coordinate: bigint;
  delta: number;
};

/**
 * Exact live coverage as cover-count deltas at interval boundaries. Inserting
 * coverage writes +1 at rLow and −1 at rHigh; removing withdrawn coverage
 * writes the inverse pair. Callers must only remove coverage they previously
 * inserted — the running count going negative is corrupt state and `union`
 * throws on it.
 */
export class LiveCoverageUnion {
  #boundaries: CoverageBoundary[] = [];

  get boundaryCount(): number {
    return this.#boundaries.length;
  }

  /**
   * Read-cost model for a withdrawal-time intersection: a delta list has no
   * absolute counts, so knowing the coverage inside a span means walking
   * every boundary from the left end of the structure through the span.
   */
  boundariesNotAfter(coordinate: bigint): number {
    return this.#boundaries.filter((boundary) => boundary.coordinate <= coordinate).length;
  }

  insert(segment: PathSegment): CoverageWriteCosts {
    return this.#applyPair(segment, 1);
  }

  remove(segment: PathSegment): CoverageWriteCosts {
    return this.#applyPair(segment, -1);
  }

  /** The live covered intervals: maximal runs with a positive running count. */
  union(): PathSegment[] {
    const covered: PathSegment[] = [];
    let count = 0;
    let openedAt = 0n;
    for (const boundary of this.#boundaries) {
      if (count === 0 && boundary.delta > 0) openedAt = boundary.coordinate;
      count += boundary.delta;
      if (count < 0) {
        throw new Error(`Negative cover count at ${boundary.coordinate}.`);
      }
      if (count === 0) covered.push({ rHigh: boundary.coordinate, rLow: openedAt });
    }
    if (count !== 0) {
      throw new Error("Unbalanced coverage deltas.");
    }
    return normalizePathSegments(covered);
  }

  #applyPair(segment: PathSegment, sign: 1 | -1): CoverageWriteCosts {
    if (segment.rHigh < segment.rLow) {
      throw new Error(`Inverted path segment [${segment.rLow}, ${segment.rHigh}].`);
    }
    const costs = noWrites();
    if (segment.rHigh === segment.rLow) return costs;
    this.#applyDelta(segment.rLow, sign, costs);
    this.#applyDelta(segment.rHigh, -sign, costs);
    return costs;
  }

  #applyDelta(coordinate: bigint, amount: number, costs: CoverageWriteCosts): void {
    let index = 0;
    while (index < this.#boundaries.length && this.#boundaries[index]!.coordinate < coordinate) {
      index += 1;
    }
    const existing = this.#boundaries[index];
    if (existing !== undefined && existing.coordinate === coordinate) {
      existing.delta += amount;
      if (existing.delta === 0) {
        this.#boundaries.splice(index, 1);
        costs.recordsDeleted += 1;
      } else {
        costs.recordsRewritten += 1;
      }
      return;
    }
    this.#boundaries.splice(index, 0, { coordinate, delta: amount });
    costs.recordsCreated += 1;
  }
}
