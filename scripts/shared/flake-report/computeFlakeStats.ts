export interface WorkflowRunRecord {
  workflowName: string;
  headSha: string;
  event: string;
  status: string;
  conclusion: string | null;
  runAttempt: number;
  createdAt: string;
}

export interface FlakeStatsOptions {
  windowStart: string;
  windowEnd: string;
  workflows: string[];
}

export interface WorkflowFlakeStats {
  workflowName: string;
  completedRuns: number;
  failures: number;
  failureRatePct: number | null;
  rerunPasses: number;
  flakeRatePct: number | null;
  wouldAlert: boolean;
}

/** Report-only threshold (ADR 0017): computed and shown, never alerting. */
export const FLAKE_ALERT_THRESHOLD_PCT = 5;

function ratePct(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return Math.round((part / whole) * 10000) / 100;
}

/**
 * Aggregate completed workflow runs into per-workflow failure and flake
 * rates. A run listed with runAttempt > 1 is the latest attempt, so a
 * success there means an earlier attempt on the same commit failed and the
 * rerun passed — the flake signal per ADR 0017. Cancelled and skipped runs
 * (concurrency-group cancels, path-filter skips) are not evidence either
 * way and stay out of the denominator.
 */
export function computeFlakeStats(
  runs: WorkflowRunRecord[],
  options: FlakeStatsOptions,
): WorkflowFlakeStats[] {
  const windowStart = Date.parse(options.windowStart);
  const windowEnd = Date.parse(options.windowEnd);

  return options.workflows.map((workflowName) => {
    const considered = runs.filter((run) => {
      if (run.workflowName !== workflowName) return false;
      if (run.status !== "completed") return false;
      if (run.conclusion === "cancelled" || run.conclusion === "skipped") {
        return false;
      }
      const createdAt = Date.parse(run.createdAt);
      return createdAt >= windowStart && createdAt <= windowEnd;
    });

    const completedRuns = considered.length;
    const failures = considered.filter(
      (run) => run.conclusion === "failure",
    ).length;
    const rerunPasses = considered.filter(
      (run) => run.conclusion === "success" && run.runAttempt > 1,
    ).length;
    const flakeRatePct = ratePct(rerunPasses, completedRuns);

    return {
      workflowName,
      completedRuns,
      failures,
      failureRatePct: ratePct(failures, completedRuns),
      rerunPasses,
      flakeRatePct,
      wouldAlert:
        flakeRatePct !== null && flakeRatePct > FLAKE_ALERT_THRESHOLD_PCT,
    };
  });
}
