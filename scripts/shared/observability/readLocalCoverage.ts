import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { COVERAGE_WORKSPACES } from "../coverage-report/coverageWorkspaces.ts";
import {
  matchesLcovFilter,
  normalizeSourcePath,
} from "../coverage-report/parseLcovSummary.ts";

/**
 * Per-file coverage read from lcov reports produced by *local* runs.
 *
 * The ci-metrics datastore only carries per-workspace summaries, so per-folder
 * rates have to come from the lcov each suite writes on disk. That makes this
 * data as old as the last local coverage run — which is why every source
 * carries its file mtime and the dashboard shows that age rather than
 * presenting it as current.
 */
export interface LocalCoverageFile {
  /** Repo-relative path, so it lines up with the test inventory's paths. */
  path: string;
  lines: { hit: number; found: number };
  functions: { hit: number; found: number };
}

export interface LocalCoverageSource {
  workspace: string;
  /** Repo-relative lcov path, so a missing report can be named precisely. */
  lcovPath: string;
  /** File mtime (ISO8601), or null when the report isn't there. */
  generatedAt: string | null;
  present: boolean;
  files: number;
}

export interface LocalCoverage {
  files: LocalCoverageFile[];
  sources: LocalCoverageSource[];
}

/**
 * Where each workspace's suite writes its lcov locally, and the directory its
 * `SF:` paths are relative to. These are local run-output locations (set by
 * each runner's own config), not the CI artifact names in COVERAGE_WORKSPACES,
 * so they are named here.
 */
const LOCAL_LCOV: { workspace: string; lcovPath: string; rootDir: string }[] = [
  { workspace: "app", lcovPath: "app/coverage/lcov.info", rootDir: "app" },
  { workspace: "server", lcovPath: "server/coverage/lcov.info", rootDir: "server" },
  {
    workspace: "protocol-solidity",
    lcovPath: "protocol/coverage/lcov.info",
    rootDir: "protocol",
  },
  {
    workspace: "protocol-ts",
    lcovPath: "protocol/coverage-ts/lcov.info",
    rootDir: "protocol",
  },
];

/** Accumulates the `LF/LH/FNF/FNH` totals lcov emits per source file. */
function parseRecords(
  text: string,
  rootDir: string,
  filter: Parameters<typeof matchesLcovFilter>[1],
): LocalCoverageFile[] {
  const files: LocalCoverageFile[] = [];
  let current: LocalCoverageFile | null = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("SF:")) {
      const path = normalizeSourcePath(line.slice(3));
      current = matchesLcovFilter(path, filter)
        ? {
            path: `${rootDir}/${path}`,
            lines: { hit: 0, found: 0 },
            functions: { hit: 0, found: 0 },
          }
        : null;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("LF:")) current.lines.found = Number(line.slice(3)) || 0;
    else if (line.startsWith("LH:")) current.lines.hit = Number(line.slice(3)) || 0;
    else if (line.startsWith("FNF:")) current.functions.found = Number(line.slice(4)) || 0;
    else if (line.startsWith("FNH:")) current.functions.hit = Number(line.slice(4)) || 0;
    else if (line === "end_of_record") {
      files.push(current);
      current = null;
    }
  }
  return files;
}

/**
 * Reads every workspace's local lcov. A missing report is reported as
 * `present: false` rather than omitted, so the dashboard can say which
 * workspace needs a coverage run instead of silently showing nothing.
 */
export function readLocalCoverage(repoRoot: string): LocalCoverage {
  const files: LocalCoverageFile[] = [];
  const sources: LocalCoverageSource[] = [];

  for (const entry of LOCAL_LCOV) {
    const configured = COVERAGE_WORKSPACES.find(
      (workspace) => workspace.key === entry.workspace,
    );
    const absolute = join(repoRoot, entry.lcovPath);
    let text: string | null = null;
    let generatedAt: string | null = null;
    try {
      text = readFileSync(absolute, "utf8");
      generatedAt = statSync(absolute).mtime.toISOString();
    } catch {
      text = null;
    }
    const parsed =
      text && configured
        ? parseRecords(text, entry.rootDir, configured.filter)
        : [];
    files.push(...parsed);
    sources.push({
      workspace: entry.workspace,
      lcovPath: entry.lcovPath,
      generatedAt,
      present: text !== null,
      files: parsed.length,
    });
  }

  return { files, sources };
}
