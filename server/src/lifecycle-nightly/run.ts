import "./env";

import { closeDb } from "src/db/client";

import { runScenarios, type Scenario } from "./report";
import { aiOutage } from "./scenarios/ai-outage";
import { drawCancel } from "./scenarios/draw-cancel";
import { failedGraduation } from "./scenarios/failed-graduation";
import { happyPath } from "./scenarios/happy-path";
import { indexerRestart } from "./scenarios/indexer-restart";
import { manualReview } from "./scenarios/manual-review";
import { partialClearing } from "./scenarios/partial-clearing";
import { rejectedCreation } from "./scenarios/rejected-creation";

/**
 * Entry point for the lifecycle nightly suite (ADR 0017 Track C item C3;
 * ADR 0014 holds the scenario checklist). Requires a fully booted local
 * stack — chain, API, indexer, keeper, and the heuristic review/resolution
 * services — normally provided by `pnpm local:lifecycle-nightly`.
 *
 * Scenario order matters twice over: chain-time jumps are global,
 * forward-only, and leave a PERMANENT chain-vs-wall offset (hardhat keeps
 * jump offsets; they never decay), and scenarios needing the resolution
 * runner wait out wall-clock time equal to their resolution window plus
 * every offset accumulated before their market was created. So the
 * resolution-dependent scenarios run first — each later one budgets its
 * predecessors' jumps into its wait — and jump-only or jump-free scenarios
 * run last. The partial-clearing scenario and the two infrastructure drills
 * neither resolve nor jump, so they add no offset and trail the group.
 */
const SCENARIOS: readonly Scenario[] = [
  happyPath,
  drawCancel,
  partialClearing,
  failedGraduation,
  manualReview,
  rejectedCreation,
  indexerRestart,
  aiOutage,
];

const only = process.env.POPCHARTS_LIFECYCLE_SCENARIO;
const selected = only
  ? SCENARIOS.filter((scenario) => scenario.name === only)
  : SCENARIOS;

if (only && selected.length === 0) {
  console.error(
    `Unknown scenario "${only}". Known: ${SCENARIOS.map((s) => s.name).join(", ")}`,
  );
  process.exit(1);
}

// A wedged I/O call (a fetch with no timeout, a stuck transaction-receipt
// wait) would otherwise park the runner until the CI job's own kill with no
// summary; the hard deadline turns any hang into a loud failure while the
// step-level waitForCondition budgets handle ordinary slowness.
const suiteTimeoutMs = Number(
  process.env.POPCHARTS_LIFECYCLE_SUITE_TIMEOUT_MS ?? 40 * 60 * 1000,
);
setTimeout(() => {
  console.error(
    `Lifecycle suite exceeded its ${suiteTimeoutMs}ms deadline; aborting.`,
  );
  process.exit(1);
}, suiteTimeoutMs);

let exitCode = 1;
try {
  exitCode = await runScenarios(selected);
} finally {
  await closeDb();
}

// Exit explicitly: any stray handle (a service's keep-alive socket, a timer)
// would otherwise park the process after the summary and hang the nightly.
process.exit(exitCode);
