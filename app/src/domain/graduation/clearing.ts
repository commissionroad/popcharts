import type { PriceBand } from "@/domain/receipts/types";

export type GraduationProgress = {
  matchedUsd: number;
  percent: number;
  ratio: number;
  ready: boolean;
  targetUsd: number;
};

export function calculateGraduationProgress({
  matchedUsd,
  targetUsd,
}: {
  matchedUsd: number;
  targetUsd: number;
}): GraduationProgress {
  if (targetUsd <= 0) {
    throw new Error("targetUsd must be positive");
  }

  const ratio = Math.max(0, matchedUsd) / targetUsd;

  return {
    matchedUsd,
    percent: Math.min(ratio * 100, 100),
    ratio,
    ready: ratio >= 1,
    targetUsd,
  };
}

export function isBandMatched({
  band,
  noBands,
  yesBands,
}: {
  band: PriceBand;
  noBands: PriceBand[];
  yesBands: PriceBand[];
}) {
  return (
    yesBands.some((yesBand) => overlapPriceBand(band, yesBand)) &&
    noBands.some((noBand) => overlapPriceBand(band, noBand))
  );
}

export function overlapPriceBand(a: PriceBand, b: PriceBand): PriceBand | null {
  const left = Math.max(
    Math.min(a.fromProbability, a.toProbability),
    Math.min(b.fromProbability, b.toProbability)
  );
  const right = Math.min(
    Math.max(a.fromProbability, a.toProbability),
    Math.max(b.fromProbability, b.toProbability)
  );

  if (left >= right) {
    return null;
  }

  return {
    fromProbability: left,
    toProbability: right,
  };
}
