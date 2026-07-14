export interface CoverageCounts {
  hit: number;
  found: number;
  pct: number | null;
}

export interface CoverageSummary {
  files: number;
  lines: CoverageCounts;
  functions: CoverageCounts;
  branches: CoverageCounts;
}

export interface LcovFilter {
  /** Keep only records whose SF path starts with one of these prefixes. */
  include: string[];
  /** Drop records whose SF path starts with one of these prefixes. */
  exclude: string[];
}

function pct(hit: number, found: number): number | null {
  if (found === 0) return null;
  return Math.round((hit / found) * 10000) / 100;
}

function normalizeSourcePath(raw: string): string {
  let path = raw.trim();
  while (path.startsWith("./")) path = path.slice(2);
  return path;
}

/**
 * Summarize an lcov report down to hit/found totals, keeping only the files
 * that belong to the workspace being reported (workspace-own denominators
 * per ADR 0017 — a suite's coverage of another workspace's files is
 * attributed to that workspace, not this one).
 */
export function parseLcovSummary(
  lcovText: string,
  filter: LcovFilter,
): CoverageSummary {
  let files = 0;
  let linesHit = 0;
  let linesFound = 0;
  let functionsHit = 0;
  let functionsFound = 0;
  let branchesHit = 0;
  let branchesFound = 0;

  let included = false;
  for (const rawLine of lcovText.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("SF:")) {
      const path = normalizeSourcePath(line.slice(3));
      included =
        filter.include.some((prefix) => path.startsWith(prefix)) &&
        !filter.exclude.some((prefix) => path.startsWith(prefix));
      if (included) files += 1;
      continue;
    }
    if (!included) continue;
    if (line.startsWith("LF:")) linesFound += Number(line.slice(3));
    else if (line.startsWith("LH:")) linesHit += Number(line.slice(3));
    else if (line.startsWith("FNF:")) functionsFound += Number(line.slice(4));
    else if (line.startsWith("FNH:")) functionsHit += Number(line.slice(4));
    else if (line.startsWith("BRF:")) branchesFound += Number(line.slice(4));
    else if (line.startsWith("BRH:")) branchesHit += Number(line.slice(4));
    else if (line === "end_of_record") included = false;
  }

  return {
    files,
    lines: { hit: linesHit, found: linesFound, pct: pct(linesHit, linesFound) },
    functions: {
      hit: functionsHit,
      found: functionsFound,
      pct: pct(functionsHit, functionsFound),
    },
    branches: {
      hit: branchesHit,
      found: branchesFound,
      pct: pct(branchesHit, branchesFound),
    },
  };
}
