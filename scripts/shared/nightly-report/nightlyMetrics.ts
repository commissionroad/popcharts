import { parseJsonl } from "../json/jsonl.ts";

/**
 * Nightly lifecycle outcomes for the ci-metrics datastore (ADR 0017 Track C,
 * item C6). The scheduled `nightly-lifecycle` workflow records one run here so
 * the morning trend view shows whether the full-stack lifecycle held overnight,
 * next to the coverage trends — the outcomes previously lived only in the
 * Actions history and the auto-filed tracking issue.
 */

/**
 * The lifecycle suites, in report order. Single source of truth for both the
 * workflow (which passes each job's result by key) and the rendered table
 * (which titles a column per suite) — so the two cannot drift.
 */
export const NIGHTLY_SUITES = [
  { key: "smoke", label: "Chain smoke" },
  { key: "scenarios", label: "Lifecycle scenarios" },
  { key: "chainE2e", label: "Chain-backed e2e" },
  { key: "terminal", label: "UI journeys" },
] as const;

/** A suite's key, and its raw GitHub job result keyed by suite. */
export type NightlySuiteKey = (typeof NIGHTLY_SUITES)[number]["key"];
export type NightlySuiteResults = Record<NightlySuiteKey, string>;

/** One recorded nightly run: its overall conclusion and each suite's result. */
export interface NightlyRun {
  /** GitHub run id — the upsert key, so a rerun updates its row in place. */
  runId: string;
  ts: string;
  commit: string;
  runUrl: string;
  conclusion: "success" | "failed";
  suites: NightlySuiteResults;
}

/** The most recent run, or null before the first nightly records one. */
export interface LatestNightly {
  version: 1;
  run: NightlyRun | null;
}

/** Green only when every suite is green; any other state fails the run. */
export function deriveConclusion(
  suites: NightlySuiteResults,
): NightlyRun["conclusion"] {
  return NIGHTLY_SUITES.every((suite) => suites[suite.key] === "success")
    ? "success"
    : "failed";
}

/**
 * Structural guard: JSON.parse only rejects bad *syntax*, but the datastore
 * outlives the code that wrote it, so a row that is valid JSON of the wrong
 * shape (an old schema, a hand-edit) would otherwise reach the renderer and
 * crash it. Dropping such a row keeps the promise that a bad row loses one data
 * point, never the whole report.
 */
function isNightlyRun(value: unknown): value is NightlyRun {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.runId === "string" &&
    typeof row.ts === "string" &&
    typeof row.commit === "string" &&
    typeof row.runUrl === "string" &&
    (row.conclusion === "success" || row.conclusion === "failed") &&
    typeof row.suites === "object" &&
    row.suites !== null
  );
}

/** Parses nightly/latest.json, treating empty, malformed, or wrong-shape as no run. */
export function parseLatestNightly(text: string | null): LatestNightly {
  if (!text) return { version: 1, run: null };
  try {
    const parsed = JSON.parse(text) as { version?: unknown; run?: unknown };
    if (parsed.version !== 1) return { version: 1, run: null };
    return { version: 1, run: isNightlyRun(parsed.run) ? parsed.run : null };
  } catch {
    return { version: 1, run: null };
  }
}

/** Parses the append-only nightly/history.jsonl, dropping any wrong-shape row. */
export function parseNightlyHistory(text: string | null): NightlyRun[] {
  return parseJsonl<unknown>(text).filter(isNightlyRun);
}

/**
 * Inserts `run`, replacing any existing row with the same `runId`, and keeps
 * the log sorted by timestamp. Upsert (not append) is what makes a re-run of
 * the update script idempotent — the retry after a push race re-runs against
 * the refetched datastore without duplicating the night's row.
 */
export function upsertNightlyHistory(
  rows: NightlyRun[],
  run: NightlyRun,
): NightlyRun[] {
  return [...rows.filter((row) => row.runId !== run.runId), run].sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0,
  );
}

/** Keeps whichever run is newer, so an out-of-order write can't regress it. */
export function latestNightlyOf(
  existing: NightlyRun | null,
  run: NightlyRun,
): NightlyRun {
  if (!existing) return run;
  return run.ts >= existing.ts ? run : existing;
}

/** Serializes runs back to JSONL (whole-file rewrite, since upsert can replace). */
export function serializeNightlyHistory(rows: NightlyRun[]): string {
  return (
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")
  );
}

const NIGHTLY_ROWS = 30;
const RESULT_MARK: Record<string, string> = {
  success: "✓",
  failure: "✗",
  cancelled: "⊘",
  skipped: "–",
};

function mark(result: string): string {
  return RESULT_MARK[result] ?? result;
}

/**
 * Renders the `## Nightly lifecycle` section (newest first, capped), or an
 * empty string before the first run so no blank section appears. The result
 * cell links to its run so a red morning glance is one click from the logs.
 */
export function renderNightlySection(runs: NightlyRun[]): string {
  if (runs.length === 0) return "";
  const recent = runs.slice(-NIGHTLY_ROWS).reverse();
  const header = ["Date", "Commit", "Result", ...NIGHTLY_SUITES.map((s) => s.label)];
  const lines: string[] = [];
  lines.push("## Nightly lifecycle");
  lines.push("");
  lines.push(
    "Scheduled full-stack lifecycle run (ADR 0017 Track C). Newest first; the result links to its run.",
  );
  lines.push("");
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const run of recent) {
    const result =
      run.conclusion === "success"
        ? `[✓ pass](${run.runUrl})`
        : `[✗ fail](${run.runUrl})`;
    const suiteMarks = NIGHTLY_SUITES.map((s) => mark(run.suites[s.key] ?? "–"));
    lines.push(
      `| ${run.ts.slice(0, 10)} | \`${run.commit.slice(0, 7)}\` | ${result} | ${suiteMarks.join(" | ")} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
