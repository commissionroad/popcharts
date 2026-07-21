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

export function workspacesForWorkflow(
  workflowName: string,
): CoverageWorkspace[] {
  return COVERAGE_WORKSPACES.filter((w) => w.workflowName === workflowName);
}

export function workspaceForKey(key: string): CoverageWorkspace | undefined {
  return COVERAGE_WORKSPACES.find((w) => w.key === key);
}
