// Renders the sticky PR coverage comment body for one workspace's CI run.
// Called by .github/workflows/test-observability.yml; prints the full new
// comment body to stdout. Pure transformation — all GitHub API I/O stays in
// the workflow.
//
// Usage:
//   node --experimental-strip-types scripts/ci-report-coverage-comment.ts \
//     --workspace <key> --lcov <path> --head-sha <sha> \
//     [--baseline <latest.json path>] [--existing-body <path>] \
//     [--playwright-report <report.json path>]

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  parseCommentPayload,
  renderComment,
  upsertCommentEntry,
} from "./shared/coverage-report/coverageComment.ts";
import { parseLatestCoverage } from "./shared/coverage-report/coverageMetrics.ts";
import { workspaceForKey } from "./shared/coverage-report/coverageWorkspaces.ts";
import { parseLcovSummary } from "./shared/coverage-report/parseLcovSummary.ts";
import { parsePlaywrightReport } from "./shared/coverage-report/parsePlaywrightReport.ts";
import { readTextOrNull } from "./shared/json/readTextOrNull.ts";

const { values } = parseArgs({
  options: {
    workspace: { type: "string" },
    lcov: { type: "string" },
    "head-sha": { type: "string" },
    baseline: { type: "string" },
    "existing-body": { type: "string" },
    "playwright-report": { type: "string" },
  },
});

const workspaceKey = values.workspace;
const lcovPath = values.lcov;
const headSha = values["head-sha"];
if (!workspaceKey || !lcovPath || !headSha) {
  console.error(
    "usage: ci-report-coverage-comment --workspace <key> --lcov <path> --head-sha <sha> [--baseline <path>] [--existing-body <path>]",
  );
  process.exit(2);
}

const workspace = workspaceForKey(workspaceKey);
if (!workspace) {
  console.error(`unknown workspace key: ${workspaceKey}`);
  process.exit(2);
}

const summary = parseLcovSummary(readFileSync(lcovPath, "utf8"), workspace.filter);

const latest = parseLatestCoverage(readTextOrNull(values.baseline));
const baselineEntry = latest.workspaces[workspace.key];
const baseline = baselineEntry
  ? {
      linesPct: baselineEntry.summary.lines.pct,
      commit: baselineEntry.commit,
    }
  : null;

const e2e = parsePlaywrightReport(readTextOrNull(values["playwright-report"]));

const payload = upsertCommentEntry(
  parseCommentPayload(readTextOrNull(values["existing-body"])),
  workspace.key,
  { summary, headSha, baseline, ...(e2e ? { e2e } : {}) },
);

process.stdout.write(renderComment(payload));
