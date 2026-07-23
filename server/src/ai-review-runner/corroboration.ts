import type { ReviewResult } from "src/ai-review/types";

/**
 * Escalating-corroboration policy for consequential review verdicts (ADR
 * 0019). A single model run may commit only the safe verdict
 * (manual_review); the terminal verdicts — approve, which puts a market
 * on-chain, and reject, which burns the creator's fee — must be confirmed
 * by an agreeing second run, with a third run as tiebreak. When no majority
 * for a terminal verdict survives, the market is demoted to manual_review
 * so a human decides instead of a coin flip between samples.
 *
 * Hard-flag rejects skip corroboration: they come from the service's
 * deterministic pre-stage (pattern rules, not model judgment) and cannot
 * wobble between runs.
 */

/** Maximum service calls one corroborated review may spend. */
export const MAX_CORROBORATION_RUNS = 3;

export type CorroborationOutcome =
  /** Run 1 was manual_review or a deterministic hard-flag reject. */
  | "single_pass"
  /** Run 2 agreed with run 1's terminal verdict. */
  | "confirmed"
  /** Runs disagreed; the tiebreak produced a terminal-verdict majority. */
  | "tiebreak_confirmed"
  /** No terminal majority — the market parks for a human. */
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

/** True for the verdicts that commit an irreversible on-chain transition. */
export function isTerminalReviewVerdict(
  verdict: ReviewResult["verdict"],
): boolean {
  return verdict === "approve" || verdict === "reject";
}

/**
 * True when a reject came from the deterministic pre-stage rather than model
 * judgment: those runs carry the triggering hard flags and are exactly
 * reproducible, so a second run can only burn budget.
 */
export function isDeterministicReject(result: ReviewResult): boolean {
  return result.verdict === "reject" && result.hardFlags.length > 0;
}

/**
 * Runs the review service up to MAX_CORROBORATION_RUNS times and applies the
 * escalation rules. `callService` performs one stateless review;
 * `onBeforeRun` fires before each additional call so the job's lease can be
 * renewed (a corroborated review may legitimately outlive one lease window).
 */
export async function corroborateReview({
  callService,
  onBeforeRun,
}: {
  callService: () => Promise<ReviewResult>;
  onBeforeRun?: (run: number) => Promise<void>;
}): Promise<CorroboratedReview> {
  const first = await callService();
  const runs: ReviewResult[] = [first];

  if (!isTerminalReviewVerdict(first.verdict) || isDeterministicReject(first)) {
    return { outcome: "single_pass", result: first, runs };
  }

  await onBeforeRun?.(2);
  const second = await callService();
  runs.push(second);

  if (second.verdict === first.verdict) {
    return { outcome: "confirmed", result: second, runs };
  }

  await onBeforeRun?.(3);
  const third = await callService();
  runs.push(third);

  const winner = terminalMajority(runs);
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
 * Returns the latest run carrying a terminal verdict that at least two runs
 * agree on, or null when no terminal verdict has a majority. The latest
 * matching run is used as the deciding result so the audit trail reads
 * chronologically: the deciding row is always the newest one.
 */
function terminalMajority(runs: ReviewResult[]): ReviewResult | null {
  for (const candidate of ["approve", "reject"] as const) {
    const matching = runs.filter((run) => run.verdict === candidate);
    if (matching.length >= 2) {
      return matching[matching.length - 1] ?? null;
    }
  }
  return null;
}

/**
 * Builds the deciding result for a failed corroboration: run 1's audit
 * content with the verdict forced to manual_review and the disagreement
 * spelled out first in reasons, so operators see why the market parked.
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
