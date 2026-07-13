import type { MarketResolutionMetadata, ResolutionFinding } from "./types";

/**
 * Deterministic offline resolution used for local development, tests, and the
 * lifecycle smoke. It reads an explicit outcome marker from the seeded market
 * text — `[heuristic-outcome: yes|no|draw|too_early|abstain]` — so scenarios can
 * drive a known result without a model or the network. Real markets never carry
 * the marker, so the heuristic abstains on them (safe default).
 */
const OUTCOME_MARKER =
  /\[heuristic-outcome:\s*(yes|no|draw|too_early|abstain)\s*\]/i;

export function marketText(metadata: MarketResolutionMetadata): string {
  return [
    metadata.question,
    metadata.description ?? "",
    metadata.resolutionCriteria,
    ...(metadata.resolutionSources ?? []),
  ].join("\n");
}

export function runHeuristicResolution(
  metadata: MarketResolutionMetadata,
): ResolutionFinding {
  const marker = marketText(metadata).match(OUTCOME_MARKER)?.[1]?.toLowerCase();
  const outcome =
    marker === "yes" ||
    marker === "no" ||
    marker === "draw" ||
    marker === "too_early"
      ? marker
      : "abstain";
  const decided = outcome === "yes" || outcome === "no";

  return {
    confidence: decided ? 1 : null,
    hardFlags: [],
    outcome,
    reasons: [
      marker
        ? `Heuristic outcome marker resolved to "${outcome}".`
        : "No heuristic outcome marker present; abstaining.",
    ],
    sourceChecks: [],
  };
}
