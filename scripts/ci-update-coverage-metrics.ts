// Updates a checkout of the ci-metrics branch with one workspace's coverage
// from a push to main: coverage/latest.json, coverage/history.jsonl,
// TRENDS.md, and badges/<workspace>.json. Called by
// .github/workflows/test-observability.yml (which owns git commit/push);
// also used to seed the branch initially.
//
// Usage:
//   node --experimental-strip-types scripts/ci-update-coverage-metrics.ts \
//     --workspace <key> --lcov <path> --commit <sha> --dir <ci-metrics dir> \
//     [--timestamp <iso8601>]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  appendHistory,
  badgeJson,
  historyRow,
  parseHistory,
  parseLatestCoverage,
  renderTrends,
  upsertLatestCoverage,
} from "./shared/coverage-report/coverageMetrics.ts";
import { workspaceForKey } from "./shared/coverage-report/coverageWorkspaces.ts";
import { parseLcovSummary } from "./shared/coverage-report/parseLcovSummary.ts";

const { values } = parseArgs({
  options: {
    workspace: { type: "string" },
    lcov: { type: "string" },
    commit: { type: "string" },
    dir: { type: "string" },
    timestamp: { type: "string" },
  },
});

const workspaceKey = values.workspace;
const lcovPath = values.lcov;
const commit = values.commit;
const dir = values.dir;
if (!workspaceKey || !lcovPath || !commit || !dir) {
  console.error(
    "usage: ci-update-coverage-metrics --workspace <key> --lcov <path> --commit <sha> --dir <path> [--timestamp <iso8601>]",
  );
  process.exit(2);
}

const workspace = workspaceForKey(workspaceKey);
if (!workspace) {
  console.error(`unknown workspace key: ${workspaceKey}`);
  process.exit(2);
}

const timestamp = values.timestamp ?? new Date().toISOString();

function readOptional(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

const summary = parseLcovSummary(readFileSync(lcovPath, "utf8"), workspace.filter);

mkdirSync(join(dir, "coverage"), { recursive: true });
mkdirSync(join(dir, "badges"), { recursive: true });

const latestPath = join(dir, "coverage", "latest.json");
const latest = upsertLatestCoverage(
  parseLatestCoverage(readOptional(latestPath)),
  workspace.key,
  { commit, updatedAt: timestamp, summary },
);
writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`);

const historyPath = join(dir, "coverage", "history.jsonl");
const history = appendHistory(
  readOptional(historyPath),
  historyRow(workspace.key, commit, timestamp, summary),
);
writeFileSync(historyPath, history);

writeFileSync(join(dir, "TRENDS.md"), renderTrends(parseHistory(history)));

writeFileSync(
  join(dir, "badges", `${workspace.key}.json`),
  badgeJson(`${workspace.label.toLowerCase()} coverage`, summary.lines.pct),
);

console.log(
  `updated ${workspace.key}: lines ${summary.lines.pct ?? "n/a"}% (${summary.lines.hit}/${summary.lines.found}) @ ${commit.slice(0, 7)}`,
);
