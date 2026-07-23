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
  upsertLatestCoverage,
} from "./shared/coverage-report/coverageMetrics.ts";
import { workspaceForKey } from "./shared/coverage-report/coverageWorkspaces.ts";
import { parseLcovSummary } from "./shared/coverage-report/parseLcovSummary.ts";
import { readTextOrNull } from "./shared/json/readTextOrNull.ts";
import { parseNightlyHistory } from "./shared/nightly-report/nightlyMetrics.ts";
import { renderTrends } from "./shared/trends/renderTrends.ts";

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

const summary = parseLcovSummary(readFileSync(lcovPath, "utf8"), workspace.filter);

mkdirSync(join(dir, "coverage"), { recursive: true });
mkdirSync(join(dir, "badges"), { recursive: true });

const latestPath = join(dir, "coverage", "latest.json");
const latest = upsertLatestCoverage(
  parseLatestCoverage(readTextOrNull(latestPath)),
  workspace.key,
  { commit, updatedAt: timestamp, summary },
);
writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`);

const historyPath = join(dir, "coverage", "history.jsonl");
const history = appendHistory(
  readTextOrNull(historyPath),
  historyRow(workspace.key, commit, timestamp, summary),
);
writeFileSync(historyPath, history);

// Read the nightly log too so regenerating TRENDS.md preserves its section —
// this writer owns coverage, but the file is a shared view of both datastores.
const nightlyRuns = parseNightlyHistory(
  readTextOrNull(join(dir, "nightly", "history.jsonl")),
);
writeFileSync(
  join(dir, "TRENDS.md"),
  renderTrends(parseHistory(history), nightlyRuns),
);

writeFileSync(
  join(dir, "badges", `${workspace.key}.json`),
  badgeJson(`${workspace.label.toLowerCase()} coverage`, summary.lines.pct),
);

console.log(
  `updated ${workspace.key}: lines ${summary.lines.pct ?? "n/a"}% (${summary.lines.hit}/${summary.lines.found}) @ ${commit.slice(0, 7)}`,
);
