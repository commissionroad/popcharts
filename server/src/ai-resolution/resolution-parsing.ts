import {
  arrayOfStrings,
  filterSourceChecksByEvidence,
  parseSourceChecks,
} from "src/ai-review/response-parsing";

import type { ResolutionOutcome } from "./types";

/**
 * Untrusted-model-output parsing shared by every resolution provider. This is a
 * security control mirroring `src/ai-review/response-parsing`: model output is
 * never trusted, so an unrecognized outcome falls back to `abstain`, confidence
 * is clamped to [0,1] (or null), and sourceChecks not backed by collected
 * evidence are discarded. Keep exactly one implementation of these rules.
 */

export type RawModelResolution = {
  confidence?: unknown;
  hardFlags?: unknown;
  outcome?: unknown;
  reasons?: unknown;
  sourceChecks?: unknown;
};

// Re-export the shared, generic parsers so resolution providers import from one
// place; the source-check filtering (invented-source defence) is identical.
export { arrayOfStrings, filterSourceChecksByEvidence, parseSourceChecks };

/**
 * Parses the model's JSON reply, tolerating surrounding prose or markdown by
 * falling back to the outermost braced block. `providerLabel` names the provider
 * in the failure message (e.g. "Anthropic did not return JSON.").
 */
export function parseModelResolution(
  content: string,
  providerLabel: string,
): RawModelResolution {
  try {
    return JSON.parse(content) as RawModelResolution;
  } catch {
    const json = content.match(/\{[\s\S]*\}/)?.[0];
    if (!json) {
      throw new Error(`${providerLabel} did not return JSON.`);
    }

    return JSON.parse(json) as RawModelResolution;
  }
}

/** Unrecognized outcomes fall back to `abstain` (park for a human). */
export function parseOutcome(value: unknown): ResolutionOutcome {
  return value === "yes" ||
    value === "no" ||
    value === "draw" ||
    value === "too_early" ||
    value === "abstain"
    ? value
    : "abstain";
}

/** Confidence must be a finite number in [0,1]; anything else becomes null. */
export function parseConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.min(1, Math.max(0, value));
}
