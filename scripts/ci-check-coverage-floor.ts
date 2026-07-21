// Enforces a workspace's coverage floor from an lcov file (ADR 0017).
// Used where the test runner has no native threshold support (hardhat's
// Solidity coverage); bun and vitest floors live in their own configs.
//
// Usage:
//   node --experimental-strip-types scripts/ci-check-coverage-floor.ts \
//     --workspace <key> --lcov <path> --min-lines <pct>

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { workspaceForKey } from "./shared/coverage-report/coverageWorkspaces.ts";
import { parseLcovSummary } from "./shared/coverage-report/parseLcovSummary.ts";

const { values } = parseArgs({
  options: {
    workspace: { type: "string" },
    lcov: { type: "string" },
    "min-lines": { type: "string" },
  },
});

const workspaceKey = values.workspace;
const lcovPath = values.lcov;
const minLinesRaw = values["min-lines"];
if (!workspaceKey || !lcovPath || !minLinesRaw) {
  console.error(
    "usage: ci-check-coverage-floor --workspace <key> --lcov <path> --min-lines <pct>",
  );
  process.exit(2);
}

const workspace = workspaceForKey(workspaceKey);
if (!workspace) {
  console.error(`unknown workspace key: ${workspaceKey}`);
  process.exit(2);
}
const minLines = Number.parseFloat(minLinesRaw);
if (!Number.isFinite(minLines) || minLines < 0 || minLines > 100) {
  console.error(`--min-lines must be a percentage, got: ${minLinesRaw}`);
  process.exit(2);
}

const summary = parseLcovSummary(readFileSync(lcovPath, "utf8"), workspace.filter);
if (summary.lines.pct === null) {
  console.error(`no measurable lines in ${lcovPath} for ${workspace.key}`);
  process.exit(1);
}

// Compare on raw counts, not the display percentage: summary.lines.pct is
// rounded to two decimals, which would let e.g. 36.2989% pass a 36.3 floor.
const meetsFloor = summary.lines.hit * 100 >= minLines * summary.lines.found;
console.log(
  `${workspace.label} line coverage ${summary.lines.pct.toFixed(2)}% ` +
    `(${summary.lines.hit}/${summary.lines.found}) ` +
    `${meetsFloor ? "meets" : "is BELOW"} the ${minLines}% floor`,
);
if (!meetsFloor) {
  console.error(
    "Coverage floor violated (ADR 0017): add tests or, with reviewer " +
      "sign-off, lower the floor where this step is wired in CI.",
  );
  process.exit(1);
}
