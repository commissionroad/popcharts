import type { CoverageSummary } from "./parseLcovSummary.ts";
import type { E2eRetrySummary } from "./parsePlaywrightReport.ts";
import { COVERAGE_WORKSPACES } from "./coverageWorkspaces.ts";

/** Identifies the sticky comment; must stay stable across versions. */
export const COMMENT_MARKER = "<!-- popcharts-test-observability -->";

const PAYLOAD_OPEN = "<!-- payload:";
const PAYLOAD_CLOSE = "-->";

export interface CommentBaseline {
  linesPct: number | null;
  commit: string;
}

export interface CommentWorkspaceEntry {
  summary: CoverageSummary;
  headSha: string;
  baseline: CommentBaseline | null;
  /** E2E retry data (app only); absent when the suite didn't run. */
  e2e?: E2eRetrySummary | null;
}

export interface CommentPayload {
  version: 1;
  workspaces: Record<string, CommentWorkspaceEntry>;
}

export function emptyCommentPayload(): CommentPayload {
  return { version: 1, workspaces: {} };
}

/**
 * Recover the machine-readable payload from an existing comment body so a
 * later-finishing workflow can add its workspace without clobbering rows
 * written by the others. Returns an empty payload when the body is absent
 * or unparseable (the comment then rebuilds from this run alone).
 */
export function parseCommentPayload(body: string | null): CommentPayload {
  if (!body) return emptyCommentPayload();
  const start = body.indexOf(PAYLOAD_OPEN);
  if (start === -1) return emptyCommentPayload();
  const end = body.indexOf(PAYLOAD_CLOSE, start);
  if (end === -1) return emptyCommentPayload();
  const raw = body.slice(start + PAYLOAD_OPEN.length, end).trim();
  try {
    const parsed = JSON.parse(raw) as CommentPayload;
    if (parsed.version !== 1 || typeof parsed.workspaces !== "object") {
      return emptyCommentPayload();
    }
    return parsed;
  } catch {
    return emptyCommentPayload();
  }
}

export function upsertCommentEntry(
  payload: CommentPayload,
  workspaceKey: string,
  entry: CommentWorkspaceEntry,
): CommentPayload {
  return {
    version: 1,
    workspaces: { ...payload.workspaces, [workspaceKey]: entry },
  };
}

function formatPct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}%`;
}

function formatDelta(entry: CommentWorkspaceEntry): string {
  if (!entry.baseline) return "no baseline yet";
  const { linesPct, commit } = entry.baseline;
  const current = entry.summary.lines.pct;
  if (linesPct === null || current === null) return `— vs \`${commit.slice(0, 7)}\``;
  const delta = Math.round((current - linesPct) * 100) / 100;
  const sign = delta >= 0 ? "+" : "";
  const flag = delta < 0 ? " 🔻" : "";
  return `${sign}${delta.toFixed(2)}%${flag} vs \`${commit.slice(0, 7)}\``;
}

/**
 * Render the sticky PR comment. Informational only by decision (ADR 0017):
 * this comment never gates a merge.
 */
export function renderComment(payload: CommentPayload): string {
  const lines: string[] = [];
  lines.push(COMMENT_MARKER);
  lines.push(`${PAYLOAD_OPEN}${JSON.stringify(payload)}${PAYLOAD_CLOSE}`);
  lines.push("## Coverage");
  lines.push("");
  lines.push("| Workspace | Lines | Δ lines vs main | Functions | Branches |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const workspace of COVERAGE_WORKSPACES) {
    const entry = payload.workspaces[workspace.key];
    if (!entry) continue;
    const s = entry.summary;
    lines.push(
      `| ${workspace.label} | ${formatPct(s.lines.pct)} (${s.lines.hit}/${s.lines.found}) | ${formatDelta(entry)} | ${formatPct(s.functions.pct)} | ${formatPct(s.branches.pct)} |`,
    );
  }
  for (const workspace of COVERAGE_WORKSPACES) {
    const e2e = payload.workspaces[workspace.key]?.e2e;
    if (!e2e) continue;
    lines.push("");
    lines.push(
      e2e.flaky > 0
        ? `⚠️ E2E smoke (${workspace.label}): **${e2e.flaky} of ${e2e.total}** tests passed only on retry.`
        : `E2E smoke (${workspace.label}): ${e2e.total} tests, none needed a retry.`,
    );
  }
  lines.push("");
  lines.push(
    "_Workspace-own denominators; workspaces skipped by path filters are omitted. Informational only — floors are enforced in each workspace's own CI job (ADR 0017)._",
  );
  lines.push("");
  return lines.join("\n");
}
