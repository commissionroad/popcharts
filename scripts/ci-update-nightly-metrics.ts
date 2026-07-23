// Records one scheduled nightly-lifecycle outcome into a checkout of the
// ci-metrics branch (ADR 0017 Track C, item C6): nightly/latest.json,
// nightly/history.jsonl, and the co-rendered TRENDS.md. Called by
// .github/workflows/nightly-lifecycle.yml (which owns git commit/push).
//
// The write is idempotent per run id, so the workflow's push-race retry can
// re-run it against the refetched branch without duplicating the night's row.
//
// Usage:
//   node --experimental-strip-types scripts/ci-update-nightly-metrics.ts \
//     --run-id <id> --commit <sha> --run-url <url> --dir <ci-metrics dir> \
//     --smoke <result> --scenarios <result> --chain-e2e <result> \
//     --terminal <result> [--timestamp <iso8601>]

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { parseHistory } from "./shared/coverage-report/coverageMetrics.ts";
import { readTextOrNull } from "./shared/json/readTextOrNull.ts";
import {
  deriveConclusion,
  latestNightlyOf,
  parseLatestNightly,
  parseNightlyHistory,
  serializeNightlyHistory,
  upsertNightlyHistory,
  type NightlyRun,
  type NightlySuiteResults,
} from "./shared/nightly-report/nightlyMetrics.ts";
import { renderTrends } from "./shared/trends/renderTrends.ts";

const { values } = parseArgs({
  options: {
    "run-id": { type: "string" },
    commit: { type: "string" },
    "run-url": { type: "string" },
    dir: { type: "string" },
    smoke: { type: "string" },
    scenarios: { type: "string" },
    "chain-e2e": { type: "string" },
    terminal: { type: "string" },
    timestamp: { type: "string" },
  },
});

const runId = values["run-id"];
const commit = values.commit;
const runUrl = values["run-url"];
const dir = values.dir;
if (!runId || !commit || !runUrl || !dir) {
  console.error(
    "usage: ci-update-nightly-metrics --run-id <id> --commit <sha> --run-url <url> --dir <path> --smoke <result> --scenarios <result> --chain-e2e <result> --terminal <result> [--timestamp <iso8601>]",
  );
  process.exit(2);
}

// A missing suite result means a job never reported — treat it as a failure,
// never a silent pass, so a broken graph can't render green.
const suites: NightlySuiteResults = {
  smoke: values.smoke ?? "failure",
  scenarios: values.scenarios ?? "failure",
  chainE2e: values["chain-e2e"] ?? "failure",
  terminal: values.terminal ?? "failure",
};

const run: NightlyRun = {
  runId,
  ts: values.timestamp ?? new Date().toISOString(),
  commit,
  runUrl,
  conclusion: deriveConclusion(suites),
  suites,
};

mkdirSync(join(dir, "nightly"), { recursive: true });

const latestPath = join(dir, "nightly", "latest.json");
const latest = latestNightlyOf(
  parseLatestNightly(readTextOrNull(latestPath)).run,
  run,
);
writeFileSync(latestPath, `${JSON.stringify({ version: 1, run: latest }, null, 2)}\n`);

const historyPath = join(dir, "nightly", "history.jsonl");
const history = upsertNightlyHistory(
  parseNightlyHistory(readTextOrNull(historyPath)),
  run,
);
writeFileSync(historyPath, serializeNightlyHistory(history));

// Regenerate the shared view; read the coverage log so its sections survive.
const coverageHistory = parseHistory(
  readTextOrNull(join(dir, "coverage", "history.jsonl")),
);
writeFileSync(join(dir, "TRENDS.md"), renderTrends(coverageHistory, history));

console.log(
  `recorded nightly ${run.conclusion} @ ${commit.slice(0, 7)} (run ${runId})`,
);
