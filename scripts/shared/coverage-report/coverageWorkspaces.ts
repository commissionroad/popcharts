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
    filter: { include: ["src/"], exclude: [] },
  },
  {
    key: "server",
    label: "Server",
    workflowName: "Server CI",
    artifactName: "server-coverage",
    filter: { include: ["src/"], exclude: [] },
  },
  {
    key: "protocol-solidity",
    label: "Protocol (Solidity)",
    workflowName: "Protocol CI",
    artifactName: "protocol-coverage",
    filter: { include: ["contracts/"], exclude: ["contracts/mocks/"] },
  },
];

export function workspaceForWorkflow(
  workflowName: string,
): CoverageWorkspace | undefined {
  return COVERAGE_WORKSPACES.find((w) => w.workflowName === workflowName);
}

export function workspaceForKey(key: string): CoverageWorkspace | undefined {
  return COVERAGE_WORKSPACES.find((w) => w.key === key);
}
