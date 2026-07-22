import type { ResolutionResult } from "src/ai-resolution/types";

/**
 * Escalating-corroboration policy for on-chain resolution verdicts (ADR
 * 0019), the sibling of ai-review-runner/corroboration.ts. Only
 * resolve_yes / resolve_no move bettors' money irreversibly, so only those
 * verdicts require an agreeing second run (third as tiebreak); draws,
 * too_early re-queues, and manual parks are safe single-run states.
 *
 * The caller re-applies decideResolutionAction to the corroborated result:
 * a tiebreak can legitimately flip YES→NO, and the flipped verdict must
 * pass its own time gate rather than inherit the original's.
 */

export type ResolutionCorroborationOutcome =
  "confirmed" | "tiebreak_confirmed" | "demoted";

export type CorroboratedResolution = {
  outcome: ResolutionCorroborationOutcome;
  /** Deciding result; for demotions a synthesized manual_review result. */
  result: ResolutionResult;
  /** Every service run in call order, including the caller's first run. */
  runs: ResolutionResult[];
};

/** True for the verdicts that submit an irreversible on-chain resolve(). */
export function isSubmittableResolutionVerdict(
  verdict: ResolutionResult["verdict"],
): boolean {
  return verdict === "resolve_yes" || verdict === "resolve_no";
}

/**
 * Corroborates a first run that already carries a submittable verdict. The
 * caller performs run 1 and the gate check; this helper spends up to two
 * more service calls confirming it. `onBeforeRun` fires before each extra
 * call so the job lease can be renewed.
 */
export async function corroborateResolution({
  callService,
  first,
  onBeforeRun,
}: {
  callService: () => Promise<ResolutionResult>;
  first: ResolutionResult;
  onBeforeRun?: (run: number) => Promise<void>;
}): Promise<CorroboratedResolution> {
  const runs: ResolutionResult[] = [first];

  await onBeforeRun?.(2);
  const second = await callService();
  runs.push(second);

  if (second.verdict === first.verdict) {
    return { outcome: "confirmed", result: second, runs };
  }

  await onBeforeRun?.(3);
  const third = await callService();
  runs.push(third);

  const winner = submittableMajority(runs);
  if (winner) {
    return { outcome: "tiebreak_confirmed", result: winner, runs };
  }

  return { outcome: "demoted", result: demoteToManualReview(runs), runs };
}

/**
 * Returns the latest run carrying a submittable verdict at least two runs
 * agree on, or null when neither YES nor NO has a majority.
 */
function submittableMajority(
  runs: ResolutionResult[],
): ResolutionResult | null {
  for (const candidate of ["resolve_yes", "resolve_no"] as const) {
    const matching = runs.filter((run) => run.verdict === candidate);
    if (matching.length >= 2) {
      return matching[matching.length - 1] ?? null;
    }
  }
  return null;
}

/**
 * Deciding result for a failed corroboration: run 1's audit content with the
 * verdict parked to manual_review and the disagreement spelled out first.
 * The model outcome is preserved — the park reason, not the model's answer,
 * is what changed.
 */
function demoteToManualReview(runs: ResolutionResult[]): ResolutionResult {
  const first = runs[0];
  if (!first) {
    throw new Error("Corroboration demotion requires at least one run.");
  }

  const verdicts = runs.map((run) => run.verdict).join(", ");
  return {
    ...first,
    reasons: [
      `Corroboration: ${runs.length} runs disagreed (${verdicts}) with no majority for an on-chain resolution; parked for operator review.`,
      ...first.reasons,
    ],
    verdict: "manual_review",
  };
}
