// Writes FLAKES.md into a ci-metrics worktree from a window of GitHub
// Actions run data. Called weekly by .github/workflows/test-observability.yml;
// all GitHub API I/O stays in the workflow — this script only transforms.
//
// Usage:
//   node --experimental-strip-types scripts/ci-update-flake-report.ts \
//     --runs <runs.json> --dir <ci-metrics dir> \
//     --window-start <iso> --window-end <iso>

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { computeFlakeStats } from "./shared/flake-report/computeFlakeStats.ts";
import type { RawWorkflowRun } from "./shared/flake-report/normalizeRuns.ts";
import {
  FLAKE_REPORT_WORKFLOWS,
  normalizeRuns,
} from "./shared/flake-report/normalizeRuns.ts";
import { renderFlakesMarkdown } from "./shared/flake-report/renderFlakesMarkdown.ts";

const { values } = parseArgs({
  options: {
    runs: { type: "string" },
    dir: { type: "string" },
    "window-start": { type: "string" },
    "window-end": { type: "string" },
  },
});

const runsPath = values.runs;
const dir = values.dir;
const windowStart = values["window-start"];
const windowEnd = values["window-end"];
if (!runsPath || !dir || !windowStart || !windowEnd) {
  console.error(
    "usage: ci-update-flake-report --runs <path> --dir <dir> --window-start <iso> --window-end <iso>",
  );
  process.exit(2);
}

const raw = JSON.parse(readFileSync(runsPath, "utf8")) as RawWorkflowRun[];
if (!Array.isArray(raw)) {
  console.error(`expected a JSON array of workflow runs in ${runsPath}`);
  process.exit(2);
}

const stats = computeFlakeStats(normalizeRuns(raw), {
  windowStart,
  windowEnd,
  workflows: FLAKE_REPORT_WORKFLOWS,
});
writeFileSync(
  join(dir, "FLAKES.md"),
  renderFlakesMarkdown(stats, {
    generatedAt: windowEnd,
    windowStart,
    windowEnd,
  }),
);
console.log(
  stats
    .map((s) => `${s.workflowName}: flake ${s.flakeRatePct ?? "n/a"}%`)
    .join("; "),
);
