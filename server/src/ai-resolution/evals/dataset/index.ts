import { ABSTAIN_CASES } from "./abstain";
import { ADVERSARIAL_CASES } from "./adversarial";
import { CLEAR_NO_CASES } from "./clear-no";
import { CLEAR_YES_CASES } from "./clear-yes";
import type { ResolutionEvalCase } from "./dataset-types";
import { DRAW_CASES } from "./draw";
import { TOO_EARLY_CASES } from "./too-early";

export { acceptableOutcomes, type ResolutionEvalCase } from "./dataset-types";

/**
 * Every labeled seed case, id-unique and heuristic-marker-free (both
 * validated at import time). The marker guard matters: a stray
 * `[heuristic-outcome: ...]` would let the deterministic heuristic answer a
 * case that exists to measure the LLM path.
 */
export const ALL_RESOLUTION_EVAL_CASES: ResolutionEvalCase[] = validate([
  ...CLEAR_YES_CASES,
  ...CLEAR_NO_CASES,
  ...TOO_EARLY_CASES,
  ...DRAW_CASES,
  ...ABSTAIN_CASES,
  ...ADVERSARIAL_CASES,
]);

function validate(cases: ResolutionEvalCase[]): ResolutionEvalCase[] {
  const seen = new Set<string>();
  for (const evalCase of cases) {
    if (seen.has(evalCase.id)) {
      throw new Error(`Duplicate eval case id: ${evalCase.id}`);
    }
    seen.add(evalCase.id);

    const text = [
      evalCase.metadata.question,
      evalCase.metadata.description ?? "",
      evalCase.metadata.resolutionCriteria,
      ...(evalCase.metadata.resolutionSources ?? []),
    ].join("\n");
    if (/\[heuristic-outcome:/i.test(text)) {
      throw new Error(
        `Eval case ${evalCase.id} contains a heuristic outcome marker; these cases must exercise the LLM path.`,
      );
    }
  }
  return cases;
}
