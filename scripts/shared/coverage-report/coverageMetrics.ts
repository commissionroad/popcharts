import { appendJsonl, parseJsonl } from "../json/jsonl.ts";
import type { CoverageSummary } from "./parseLcovSummary.ts";
import { COVERAGE_WORKSPACES } from "./coverageWorkspaces.ts";

export interface LatestWorkspaceCoverage {
  commit: string;
  updatedAt: string;
  summary: CoverageSummary;
}

export interface LatestCoverage {
  version: 1;
  workspaces: Record<string, LatestWorkspaceCoverage>;
}

export interface HistoryRow {
  ts: string;
  workspace: string;
  commit: string;
  linesPct: number | null;
  linesHit: number;
  linesFound: number;
  functionsPct: number | null;
  branchesPct: number | null;
}

export function parseLatestCoverage(text: string | null): LatestCoverage {
  if (!text) return { version: 1, workspaces: {} };
  try {
    const parsed = JSON.parse(text) as LatestCoverage;
    if (parsed.version !== 1 || typeof parsed.workspaces !== "object") {
      return { version: 1, workspaces: {} };
    }
    return parsed;
  } catch {
    return { version: 1, workspaces: {} };
  }
}

export function upsertLatestCoverage(
  latest: LatestCoverage,
  workspaceKey: string,
  update: LatestWorkspaceCoverage,
): LatestCoverage {
  return {
    version: 1,
    workspaces: { ...latest.workspaces, [workspaceKey]: update },
  };
}

export function historyRow(
  workspaceKey: string,
  commit: string,
  ts: string,
  summary: CoverageSummary,
): HistoryRow {
  return {
    ts,
    workspace: workspaceKey,
    commit,
    linesPct: summary.lines.pct,
    linesHit: summary.lines.hit,
    linesFound: summary.lines.found,
    functionsPct: summary.functions.pct,
    branchesPct: summary.branches.pct,
  };
}

export function appendHistory(existing: string | null, row: HistoryRow): string {
  return appendJsonl(existing, row);
}

export function parseHistory(text: string | null): HistoryRow[] {
  return parseJsonl<HistoryRow>(text);
}

/** shields-style endpoint JSON served raw from the ci-metrics branch. */
export function badgeJson(label: string, linesPct: number | null): string {
  let color = "lightgrey";
  let message = "unknown";
  if (linesPct !== null) {
    message = `${linesPct.toFixed(1)}%`;
    if (linesPct >= 95) color = "brightgreen";
    else if (linesPct >= 85) color = "green";
    else if (linesPct >= 70) color = "yellowgreen";
    else if (linesPct >= 60) color = "yellow";
    else if (linesPct >= 45) color = "orange";
    else color = "red";
  }
  return `${JSON.stringify({ schemaVersion: 1, label, message, color })}\n`;
}

const TRENDS_ROWS_PER_WORKSPACE = 30;

function formatPct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}%`;
}

/**
 * Renders the per-workspace coverage tables (the `## <workspace>` blocks),
 * newest row first. Title-less on purpose: `renderTrends` in
 * `shared/trends` owns the document, placing these below the nightly section.
 */
export function renderCoverageSections(history: HistoryRow[]): string {
  const lines: string[] = [];
  for (const workspace of COVERAGE_WORKSPACES) {
    const rows = history
      .filter((row) => row.workspace === workspace.key)
      .slice(-TRENDS_ROWS_PER_WORKSPACE)
      .reverse();
    if (rows.length === 0) continue;
    lines.push(`## ${workspace.label}`);
    lines.push("");
    lines.push("| Date | Commit | Lines | Functions | Branches |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const row of rows) {
      lines.push(
        `| ${row.ts.slice(0, 10)} | \`${row.commit.slice(0, 7)}\` | ${formatPct(row.linesPct)} (${row.linesHit}/${row.linesFound}) | ${formatPct(row.functionsPct)} | ${formatPct(row.branchesPct)} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
