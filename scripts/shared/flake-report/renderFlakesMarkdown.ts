import type { WorkflowFlakeStats } from "./computeFlakeStats.ts";
import { FLAKE_ALERT_THRESHOLD_PCT } from "./computeFlakeStats.ts";

export interface FlakesReportMeta {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
}

function formatRate(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(1)}%`;
}

/** Render FLAKES.md for the ci-metrics branch. Pure function of its inputs. */
export function renderFlakesMarkdown(
  stats: WorkflowFlakeStats[],
  meta: FlakesReportMeta,
): string {
  const lines: string[] = [];
  lines.push("# Flake report");
  lines.push("");
  lines.push(
    `Window ${meta.windowStart} → ${meta.windowEnd}; generated ${meta.generatedAt}.`,
  );
  lines.push("");
  lines.push(
    `| Workflow | Completed runs | Failures | Failure % | Rerun-passes | Flake % | >${FLAKE_ALERT_THRESHOLD_PCT}% threshold |`,
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const s of stats) {
    lines.push(
      `| ${s.workflowName} | ${s.completedRuns} | ${s.failures} | ${formatRate(s.failureRatePct)} | ${s.rerunPasses} | ${formatRate(s.flakeRatePct)} | ${s.wouldAlert ? "yes — would alert" : "no"} |`,
    );
  }
  lines.push("");
  lines.push(
    "A rerun-pass is a run whose latest attempt succeeded with `run_attempt > 1`: an earlier attempt on the same commit failed and the rerun passed — the flake signal. Cancelled and skipped runs are excluded from the denominator.",
  );
  lines.push("");
  lines.push(
    "_Informational only (ADR 0017): the threshold is computed but does not alert. Alerting is deliberately deferred until this report has enough history to prove the threshold meaningful._",
  );
  lines.push("");
  return lines.join("\n");
}
