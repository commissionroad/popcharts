import { execFileSync } from "node:child_process";

import {
  parseHistory,
  type HistoryRow,
} from "../coverage-report/coverageMetrics.ts";
import {
  parseLatestNightly,
  parseNightlyHistory,
  type NightlyRun,
} from "../nightly-report/nightlyMetrics.ts";

/**
 * A point-in-time read of the ci-metrics datastore for the local dashboard
 * (ADR 0017). The trend logs and latest-summaries are the same JSON the CI
 * workflows write; this reads them straight from the `origin/ci-metrics` ref so
 * the dashboard reflects whatever CI has pushed, without a working checkout of
 * that orphan branch.
 */
export interface ObservabilitySnapshot {
  /** When this server read the data (ISO8601) — the dashboard's "as of". */
  readAt: string;
  /** ci-metrics branch tip: the freshness the data itself carries. */
  source: { commit: string | null; committedAt: string | null };
  /** False when the git fetch failed (offline) — data may be stale. */
  online: boolean;
  coverage: { latest: CoverageLatest | null; history: HistoryRow[] };
  nightly: { latest: NightlyRun | null; history: NightlyRun[] };
}

/** The shape of coverage/latest.json the dashboard consumes (partial). */
export interface CoverageLatest {
  version: number;
  workspaces: Record<
    string,
    {
      commit: string;
      updatedAt: string;
      summary: {
        files: number;
        lines: { hit: number; found: number; pct: number | null };
        functions: { hit: number; found: number; pct: number | null };
        branches: { hit: number; found: number; pct: number | null };
      };
    }
  >;
}

const REF = "origin/ci-metrics";

/** Reads one file from the ci-metrics ref, or null when it isn't there yet. */
function readRefFile(repoRoot: string, path: string): string | null {
  try {
    return execFileSync("git", ["show", `${REF}:${path}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // Absent path (e.g. nightly/* before the first nightly records) or no ref.
    return null;
  }
}

function gitLine(repoRoot: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Fetches the latest ci-metrics ref and reads it into a snapshot. The fetch is
 * best-effort: offline, `online` is false and the last-fetched ref is served
 * rather than failing. JSON is parsed through the same helpers the CI writers
 * use, so a malformed row is dropped, never fatal.
 */
export function readCiMetrics(repoRoot: string): ObservabilitySnapshot {
  let online = true;
  try {
    execFileSync("git", ["fetch", "--quiet", "origin", "ci-metrics"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
  } catch {
    online = false;
  }

  const coverageLatestText = readRefFile(repoRoot, "coverage/latest.json");
  let coverageLatest: CoverageLatest | null = null;
  try {
    coverageLatest = coverageLatestText
      ? (JSON.parse(coverageLatestText) as CoverageLatest)
      : null;
  } catch {
    coverageLatest = null;
  }

  return {
    readAt: new Date().toISOString(),
    source: {
      commit: gitLine(repoRoot, ["rev-parse", "--short", REF]),
      committedAt: gitLine(repoRoot, ["show", "-s", "--format=%cI", REF]),
    },
    online,
    coverage: {
      latest: coverageLatest,
      history: parseHistory(readRefFile(repoRoot, "coverage/history.jsonl")),
    },
    nightly: {
      latest: parseLatestNightly(readRefFile(repoRoot, "nightly/latest.json"))
        .run,
      history: parseNightlyHistory(readRefFile(repoRoot, "nightly/history.jsonl")),
    },
  };
}
