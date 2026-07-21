// Prints the coverage-workspace mapping for a CI workflow as
// $GITHUB_OUTPUT lines (`pairs=key:lcovFile ...` and `artifact=...`), so
// test-observability.yml reads the registry instead of mirroring it in a
// bash case statement (ADR 0017; the PR #210 mirrored-constants class).
//
// Usage:
//   node --experimental-strip-types scripts/ci-workspaces-for-workflow.ts \
//     --workflow "Protocol CI"

import { parseArgs } from "node:util";

import { workflowMapping } from "./shared/coverage-report/coverageWorkspaces.ts";

const { values } = parseArgs({
  options: { workflow: { type: "string" } },
});

const workflowName = values.workflow;
if (!workflowName) {
  console.error("usage: ci-workspaces-for-workflow --workflow <name>");
  process.exit(2);
}

const mapping = workflowMapping(workflowName);
if (!mapping) {
  console.error(`unknown workflow: ${workflowName}`);
  process.exit(1);
}

console.log(`pairs=${mapping.pairs}`);
console.log(`artifact=${mapping.artifact}`);
