import type { ReviewProviderName, ReviewResult } from "src/ai-review/types";

/**
 * Escalating-corroboration policy for consequential review verdicts (ADR
 * 0019). A single model run may commit only the safe verdict
 * (manual_review); the terminal verdicts — approve, which lets a market on
 * chain, and reject, which ends the submission — must be confirmed by an
 * agreeing second run, with a third run as tiebreak. When no majority for a
 * terminal verdict survives, the draft is demoted to manual_review so a
 * human decides instead of a coin flip between samples.
 *
 * Two run-1 shapes are exempt because reruns cannot disagree with them:
 * reviews under the configured `heuristic` provider (the whole pipeline is
 * deterministic — the exemption keys on the configured provider, never on
 * the result's provider field, which a degraded model outage result also
 * carries), and hard-flag rejects stamped `provider: "heuristic"`, the
 * deterministic pre-stage's provenance (see isDeterministicReject). A
 * model-provider reject that carries hard flags is model judgment — the
 * merge folds model-invented hard flags into model results — and must
 * corroborate like any other terminal verdict. Unrelated: the
 * `corroboration` score dimension, which grades evidence quality.
 */

/** Maximum service calls one corroborated review may spend. */
export const MAX_CORROBORATION_RUNS = 3;

export type CorroborationOutcome =
  /**
   * Configured heuristic provider, manual_review, or a pre-stage hard-flag
   * reject on run 1.
   */
  | "single_pass"
  /** Run 2 agreed with run 1's terminal verdict. */
  | "confirmed"
  /** Runs disagreed; the tiebreak produced a terminal-verdict majority. */
  | "tiebreak_confirmed"
  /** No terminal majority — the draft parks for a human. */
  | "demoted";

export type CorroboratedReview = {
  /** Why the final verdict was allowed to commit. */
  outcome: CorroborationOutcome;
  /**
   * The deciding result. For demotions this is a synthesized manual_review
   * result derived from run 1 (see demoteToManualReview).
   */
  result: ReviewResult;
  /** Every service run in call order; audit persists each one. */
  runs: ReviewResult[];
};

/** True for the verdicts that commit an irreversible draft transition. */
export function isTerminalReviewVerdict(
  verdict: ReviewResult["verdict"],
): boolean {
  return verdict === "approve" || verdict === "reject";
}

/**
 * True when a reject came from the deterministic pre-stage rather than model
 * judgment: those runs carry the triggering hard flags and are exactly
 * reproducible, so a second run can only burn budget. Hard flags alone do
 * not prove the pre-stage — the merge folds model-invented hard flags into
 * a model result's reject too — so the pre-stage's `provider: "heuristic"`
 * stamp is required as well. Reading provenance off the result's provider
 * field is safe in this runner because its call config sets
 * `retryProviderFailures: true` (see draftReviewCallConfig): provider
 * outages throw into the job's retry path instead of degrading to a
 * heuristic-provider fallback result, so under a configured model provider
 * a `provider: "heuristic"` result can only be the pre-stage.
 */
export function isDeterministicReject(result: ReviewResult): boolean {
  return (
    result.provider === "heuristic" &&
    result.verdict === "reject" &&
    result.hardFlags.length > 0
  );
}

/**
 * Runs the review service up to MAX_CORROBORATION_RUNS times and applies the
 * escalation rules. `callService` performs one stateless review;
 * `configuredProvider` is the provider the caller configured for those calls;
 * `onBeforeRun` fires before each additional call so the job's lease can be
 * renewed (a corroborated review may legitimately outlive one lease window).
 */
export async function corroborateReview({
  callService,
  configuredProvider,
  onBeforeRun,
}: {
  callService: () => Promise<ReviewResult>;
  configuredProvider: ReviewProviderName;
  onBeforeRun?: (run: number) => Promise<void>;
}): Promise<CorroboratedReview> {
  const first = await callService();
  const runs: ReviewResult[] = [first];

  if (
    configuredProvider === "heuristic" ||
    !isTerminalReviewVerdict(first.verdict) ||
    isDeterministicReject(first)
  ) {
    return { outcome: "single_pass", result: first, runs };
  }

  await onBeforeRun?.(2);
  const second = await callService();
  runs.push(second);

  if (
    second.verdict === first.verdict &&
    !isDegradedModelRun(second, configuredProvider)
  ) {
    return { outcome: "confirmed", result: second, runs };
  }

  await onBeforeRun?.(3);
  const third = await callService();
  runs.push(third);

  const winner = terminalMajority(runs, configuredProvider);
  if (winner) {
    return { outcome: "tiebreak_confirmed", result: winner, runs };
  }

  return {
    outcome: "demoted",
    result: demoteToManualReview(runs),
    runs,
  };
}

/**
 * Defense in depth against degraded results should the retry wiring ever
 * regress: without `retryProviderFailures` a provider outage degrades the
 * run to a `provider: "heuristic"` fallback instead of throwing, and such a
 * run must never supply the agreement that commits a terminal verdict.
 * Under intact wiring this never fires — outages throw before producing a
 * run, and the pre-stage's heuristic-provider rejects exit as single_pass
 * before any vote.
 */
function isDegradedModelRun(
  run: ReviewResult,
  configuredProvider: ReviewProviderName,
): boolean {
  return configuredProvider !== "heuristic" && run.provider === "heuristic";
}

/**
 * Returns the latest run carrying a terminal verdict that at least two runs
 * agree on, or null when no terminal verdict has a majority. Degraded
 * heuristic-provider runs under a model configuration never vote (see
 * isDegradedModelRun), so they can neither complete a majority nor become
 * the deciding result. The latest matching run is used as the deciding
 * result so the audit trail reads chronologically: the deciding row is
 * always the newest one.
 */
function terminalMajority(
  runs: ReviewResult[],
  configuredProvider: ReviewProviderName,
): ReviewResult | null {
  for (const candidate of ["approve", "reject"] as const) {
    const matching = runs.filter(
      (run) =>
        run.verdict === candidate &&
        !isDegradedModelRun(run, configuredProvider),
    );
    if (matching.length >= 2) {
      return matching[matching.length - 1] ?? null;
    }
  }
  return null;
}

/**
 * Builds the deciding result for a failed corroboration: run 1's audit
 * content with the verdict forced to manual_review and the disagreement
 * spelled out first in reasons, so operators see why the draft parked.
 */
function demoteToManualReview(runs: ReviewResult[]): ReviewResult {
  const first = runs[0];
  if (!first) {
    throw new Error("Corroboration demotion requires at least one run.");
  }

  const verdicts = runs.map((run) => run.verdict).join(", ");
  return {
    ...first,
    reasons: [
      `Corroboration: ${runs.length} runs disagreed (${verdicts}) with no majority for a terminal verdict; parked for human review.`,
      ...first.reasons,
    ],
    verdict: "manual_review",
  };
}
