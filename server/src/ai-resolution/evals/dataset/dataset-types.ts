import type {
  MarketResolutionMetadata,
  ResolutionOutcome,
} from "src/ai-resolution/types";

/**
 * One labeled resolution-eval scenario (ADR 0019). The resolution sibling of
 * `src/ai-review/evals/dataset/dataset-types.ts`: each case pins a single
 * judgment class from docs/ai-verdict-failure-taxonomy.md so eval reports can
 * attribute misses to a class rather than "the model was wrong somewhere".
 *
 * Cases are scored against the service's OUTCOME (yes/no/draw/too_early/
 * abstain), not the derived verdict — the verdict additionally depends on the
 * confidence/evidence gates in `resolver.ts` (`deriveVerdict`), which the
 * runner records but does not grade.
 *
 * Label policy:
 * - clear-yes / clear-no cases are REAL 2024–2025 events with unambiguous,
 *   well-documented public outcomes, written to the WHAT/WHERE/WHEN
 *   discipline, so both pre-trained knowledge and web search can verify them.
 * - too_early cases are genuinely unconcluded (2027+) events.
 * - draw cases are ties or postponements that the criteria explicitly map to
 *   a draw/void outcome.
 * - abstain cases are unverifiable from any public source (vague predicate,
 *   dead source, private knowledge) — guessing is the failure being measured.
 * - injection cases embed resolver-directed instructions; the safe behavior
 *   is to abstain (also the parser's fallback for unrecognized outcomes).
 *
 * IMPORTANT: no case may contain a `[heuristic-outcome: ...]` marker — these
 * cases measure the LLM path, and the marker would let the deterministic
 * heuristic (heuristics.ts) answer instead.
 */
export type ResolutionEvalCase = {
  /** Unique kebab-case id, prefixed with the class (e.g. `yes-`, `abstain-`). */
  id: string;
  /** Taxonomy class slug (see docs/ai-verdict-failure-taxonomy.md). */
  taxonomy: string;
  /** The single outcome a well-calibrated resolver should return. */
  expected: ResolutionOutcome;
  /**
   * Additional outcomes that do NOT count as a miss — for cases where two
   * behaviors are defensible (e.g. an injection case where refusing via
   * abstain and resolving per the actual evidence are both safe). `expected`
   * is still the calibration target; strict metrics use it, accuracy metrics
   * accept this set.
   */
  acceptable?: ResolutionOutcome[];
  /** One-line justification for the label; shown in miss reports. */
  rationale: string;
  /** The market metadata exactly as the service sees it (untrusted text). */
  metadata: MarketResolutionMetadata;
};

/** Outcomes that count as correct for a case (expected + acceptable). */
export function acceptableOutcomes(
  evalCase: ResolutionEvalCase,
): ResolutionOutcome[] {
  return [evalCase.expected, ...(evalCase.acceptable ?? [])];
}
