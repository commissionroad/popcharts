import { ADVERSARIAL_CASES } from "./adversarial";
import type { ReviewEvalCase } from "./dataset-types";
import { DISPUTE_PATTERN_CASES } from "./disputes";
import { GOOD_CASES } from "./good";
import { KNOWABILITY_CASES } from "./knowability";
import { SOURCE_CASES } from "./sources";
import { TIMING_CASES } from "./timing";
import { VAGUENESS_CASES } from "./vagueness";

export { acceptableVerdicts, type ReviewEvalCase } from "./dataset-types";

/** Every labeled seed case, id-unique (validated at import time). */
export const ALL_REVIEW_EVAL_CASES: ReviewEvalCase[] = dedupeGuard([
  ...GOOD_CASES,
  ...TIMING_CASES,
  ...VAGUENESS_CASES,
  ...KNOWABILITY_CASES,
  ...SOURCE_CASES,
  ...DISPUTE_PATTERN_CASES,
  ...ADVERSARIAL_CASES,
]);

function dedupeGuard(cases: ReviewEvalCase[]): ReviewEvalCase[] {
  const seen = new Set<string>();
  for (const evalCase of cases) {
    if (seen.has(evalCase.id)) {
      throw new Error(`Duplicate eval case id: ${evalCase.id}`);
    }
    seen.add(evalCase.id);
  }
  return cases;
}
