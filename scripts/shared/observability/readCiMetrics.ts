import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  parseHistory,
  type HistoryRow,
} from "../coverage-report/coverageMetrics.ts";
import { COVERAGE_WORKSPACES } from "../coverage-report/coverageWorkspaces.ts";
import {
  NIGHTLY_SUITES,
  parseLatestNightly,
  parseNightlyHistory,
  type NightlyRun,
} from "../nightly-report/nightlyMetrics.ts";

const run = promisify(execFile);

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
  /** False when the git fetch failed or timed out — data may be stale. */
  online: boolean;
  /**
   * The workspace and suite lists the page renders by, sourced from the same
   * constants the CI writers use. Injected rather than hardcoded in the page so
   * adding a workspace or lifecycle suite shows up in the dashboard without a
   * second list drifting out of sync.
   */
  config: {
    workspaces: { key: string; label: string }[];
    suites: { key: string; label: string }[];
  };
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
// Every git call is async and time-bounded, and git is forbidden from
// prompting, so a lock race (e.g. a concurrent `land`), a slow network, or a
// credential prompt can never block the event loop or hang a request — it fails
// fast and the last-known ref is served instead.
const GIT_TIMEOUT_MS = 10_000;
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
// git show of a history log is small today but grows; lift execFile's 1MB cap.
const GIT_MAX_BUFFER = 32 * 1024 * 1024;

/** Reads one file from the ci-metrics ref, or null when it isn't there yet. */
async function readRefFile(
  repoRoot: string,
  path: string,
): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["show", `${REF}:${path}`], {
      cwd: repoRoot,
      env: GIT_ENV,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
    });
    return stdout;
  } catch {
    // Absent path (e.g. nightly/* before the first nightly records), no ref,
    // or a timeout — all mean "no data to show for this file".
    return null;
  }
}

async function gitLine(
  repoRoot: string,
  args: string[],
): Promise<string | null> {
  try {
    const { stdout } = await run("git", args, {
      cwd: repoRoot,
      env: GIT_ENV,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Fetches the latest ci-metrics ref and reads it into a snapshot. Async and
 * time-bounded so it never blocks the server's event loop or hangs a request.
 * The fetch is best-effort: on failure/timeout `online` is false and the
 * last-fetched ref is served rather than erroring. JSON is parsed through the
 * same helpers the CI writers use, so a malformed row is dropped, never fatal.
 */
export async function readCiMetrics(
  repoRoot: string,
): Promise<ObservabilitySnapshot> {
  let online = true;
  try {
    await run("git", ["fetch", "--quiet", "origin", "ci-metrics"], {
      cwd: repoRoot,
      env: GIT_ENV,
      timeout: GIT_TIMEOUT_MS,
    });
  } catch {
    online = false;
  }

  const [
    commit,
    committedAt,
    coverageLatestText,
    coverageHistoryText,
    nightlyLatestText,
    nightlyHistoryText,
  ] = await Promise.all([
    gitLine(repoRoot, ["rev-parse", "--short", REF]),
    gitLine(repoRoot, ["show", "-s", "--format=%cI", REF]),
    readRefFile(repoRoot, "coverage/latest.json"),
    readRefFile(repoRoot, "coverage/history.jsonl"),
    readRefFile(repoRoot, "nightly/latest.json"),
    readRefFile(repoRoot, "nightly/history.jsonl"),
  ]);

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
    source: { commit, committedAt },
    online,
    config: {
      workspaces: COVERAGE_WORKSPACES.map(({ key, label }) => ({ key, label })),
      suites: NIGHTLY_SUITES.map(({ key, label }) => ({ key, label })),
    },
    coverage: {
      latest: coverageLatest,
      history: parseHistory(coverageHistoryText),
    },
    nightly: {
      latest: parseLatestNightly(nightlyLatestText).run,
      history: parseNightlyHistory(nightlyHistoryText),
    },
  };
}
