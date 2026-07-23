import type { LcovFilter } from "./parseLcovSummary.ts";

export interface CoverageWorkspace {
  /** Stable key used in ci-metrics files, badges, and comment payloads. */
  key: string;
  /** Human label shown in the PR comment and TRENDS.md. */
  label: string;
  /** Name of the CI workflow whose run produces this workspace's lcov. */
  workflowName: string;
  /** Name of the uploaded coverage artifact on that run. */
  artifactName: string;
  /**
   * File name of this workspace's lcov inside the artifact. One workflow can
   * carry several figures in one artifact (Protocol CI ships Solidity and TS
   * lcovs side by side), which keeps the observability workflow's
   * download-once, report-per-workspace loop free of upsert races.
   */
  lcovFile: string;
  /** Workspace-own denominator (ADR 0017): which lcov records count. */
  filter: LcovFilter;
}

// Paths in each lcov are relative to the workspace directory the suite ran
// in (app/, server/, protocol/). The server suite also instruments imported
// ../protocol files and the protocol suite instruments test harnesses under
// contracts/mocks — both are excluded from the workspace's own figure.
export const COVERAGE_WORKSPACES: CoverageWorkspace[] = [
  {
    key: "app",
    label: "App",
    workflowName: "App CI",
    artifactName: "app-coverage",
    lcovFile: "lcov.info",
    filter: { include: ["src/"], exclude: [] },
  },
  {
    key: "server",
    label: "Server",
    workflowName: "Server CI",
    artifactName: "server-coverage",
    lcovFile: "lcov.info",
    filter: { include: ["src/"], exclude: [] },
  },
  {
    key: "protocol-solidity",
    label: "Protocol (Solidity)",
    workflowName: "Protocol CI",
    artifactName: "protocol-coverage",
    lcovFile: "lcov.info",
    filter: { include: ["contracts/"], exclude: ["contracts/mocks/"] },
  },
  {
    key: "protocol-ts",
    label: "Protocol (TS)",
    workflowName: "Protocol CI",
    artifactName: "protocol-coverage",
    lcovFile: "lcov-ts.info",
    // c8 already scopes to src/ minus generated/; the filter restates it so
    // the reported figure never depends on how the lcov was produced.
    filter: { include: ["src/"], exclude: ["src/generated/"] },
  },
];

/**
 * All coverage figures the named CI workflow produces (one workflow can
 * carry several in one artifact — ADR 0017 Track G). Empty for unknown
 * workflow names.
 */
export function workspacesForWorkflow(
  workflowName: string,
): CoverageWorkspace[] {
  return COVERAGE_WORKSPACES.filter((w) => w.workflowName === workflowName);
}

export interface WorkflowMapping {
  /** Space-separated `key:lcovFile` pairs, bash-loop ready. */
  pairs: string;
  /** The single artifact all of the workflow's figures ship in. */
  artifact: string;
}

/**
 * The observability workflow's runtime view of the registry: which artifact
 * to download for a CI workflow and which key:lcovFile pairs to report from
 * it. Exists so the workflow never mirrors these literals in bash (the
 * PR #210 incident class); `ci-workspaces-for-workflow.ts` prints it.
 * Throws if the workflow's workspaces disagree on the artifact — the
 * download-once design depends on there being exactly one.
 */
export function workflowMapping(
  workflowName: string,
): WorkflowMapping | undefined {
  const workspaces = workspacesForWorkflow(workflowName);
  if (workspaces.length === 0) return undefined;
  const artifacts = new Set(workspaces.map((w) => w.artifactName));
  if (artifacts.size !== 1) {
    throw new Error(
      `workflow ${workflowName} maps to multiple artifacts: ${[...artifacts].join(", ")}`,
    );
  }
  return {
    pairs: workspaces.map((w) => `${w.key}:${w.lcovFile}`).join(" "),
    artifact: workspaces[0].artifactName,
  };
}

/** The registry entry for a stable workspace key (`app`, `protocol-ts`, …). */
export function workspaceForKey(key: string): CoverageWorkspace | undefined {
  return COVERAGE_WORKSPACES.find((w) => w.key === key);
}
