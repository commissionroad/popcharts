import { describe, expect, test } from "vitest";

import {
  calculateGraduationProgress,
  isBandMatched,
  overlapPriceBand,
} from "./clearing";

describe("graduation clearing helpers", () => {
  test("caps display progress while preserving readiness", () => {
    const progress = calculateGraduationProgress({
      matchedUsd: 760_000,
      targetUsd: 700_000,
    });

    expect(progress.percent).toBe(100);
    expect(progress.ready).toBe(true);
    expect(progress.ratio).toBeGreaterThan(1);
  });

  test("detects price-band overlap regardless of direction", () => {
    expect(
      overlapPriceBand(
        { fromProbability: 20, toProbability: 70 },
        { fromProbability: 90, toProbability: 40 }
      )
    ).toEqual({ fromProbability: 40, toProbability: 70 });
  });

  test("requires both sides for a matched band", () => {
    const matched = isBandMatched({
      band: { fromProbability: 40, toProbability: 50 },
      noBands: [{ fromProbability: 90, toProbability: 40 }],
      yesBands: [{ fromProbability: 20, toProbability: 70 }],
    });

    expect(matched).toBe(true);
  });

  test("rejects non-positive graduation targets", () => {
    expect(() =>
      calculateGraduationProgress({ matchedUsd: 100, targetUsd: 0 })
    ).toThrowError("targetUsd must be positive");
  });

  test("returns no overlap for disjoint price bands", () => {
    expect(
      overlapPriceBand(
        { fromProbability: 10, toProbability: 20 },
        { fromProbability: 30, toProbability: 40 }
      )
    ).toBeNull();
  });

  test("leaves a band unmatched when only one side overlaps", () => {
    const matched = isBandMatched({
      band: { fromProbability: 40, toProbability: 50 },
      noBands: [{ fromProbability: 90, toProbability: 95 }],
      yesBands: [{ fromProbability: 20, toProbability: 70 }],
    });

    expect(matched).toBe(false);
  });
});
