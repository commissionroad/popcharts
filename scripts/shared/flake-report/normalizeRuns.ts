import type { WorkflowRunRecord } from "./computeFlakeStats.ts";

/** The workflows the weekly flake report covers. */
export const FLAKE_REPORT_WORKFLOWS = [
  "App CI",
  "Protocol CI",
  "Server CI",
  "Nightly Lifecycle",
];

/** Shape of the GitHub REST `actions/runs` items the report consumes. */
export interface RawWorkflowRun {
  name?: string;
  head_sha?: string;
  event?: string;
  status?: string;
  conclusion?: string | null;
  run_attempt?: number;
  created_at?: string;
}

export function normalizeRuns(raw: RawWorkflowRun[]): WorkflowRunRecord[] {
  return raw.map((run) => ({
    workflowName: run.name ?? "",
    headSha: run.head_sha ?? "",
    event: run.event ?? "",
    status: run.status ?? "",
    conclusion: run.conclusion ?? null,
    runAttempt: run.run_attempt ?? 1,
    createdAt: run.created_at ?? "",
  }));
}
