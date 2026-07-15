import type { MarketReviewMetadata, ReviewVerdict } from "src/ai-review/types";

/**
 * One labeled review-eval scenario (ADR 0019). Cases are hand-written seeds:
 * each pins a single failure (or success) mode from the taxonomy in
 * docs/ai-verdict-failure-taxonomy.md so eval reports can attribute misses
 * to a specific judgment class rather than "the model was wrong somewhere".
 */
export type ReviewEvalCase = {
  /** Unique kebab-case id, prefixed with the taxonomy class. */
  id: string;
  /** Taxonomy class slug (see docs/ai-verdict-failure-taxonomy.md). */
  taxonomy: string;
  /** The single verdict a well-calibrated reviewer should return. */
  expected: ReviewVerdict;
  /**
   * Additional verdicts that do NOT count as a miss — for genuinely
   * borderline cases where approve vs manual_review is a judgment call.
   * `expected` is still the calibration target; strict-agreement metrics
   * use it, accuracy metrics accept this set.
   */
  acceptable?: ReviewVerdict[];
  /** One-line justification for the label; shown in miss reports. */
  rationale: string;
  /** The market submission under review, exactly as the service sees it. */
  metadata: MarketReviewMetadata;
};

/** Verdicts that count as correct for a case (expected + acceptable). */
export function acceptableVerdicts(evalCase: ReviewEvalCase): ReviewVerdict[] {
  return [evalCase.expected, ...(evalCase.acceptable ?? [])];
}
