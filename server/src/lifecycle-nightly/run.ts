import "./env";

import { closeDb } from "src/db/client";

import { runScenarios, type Scenario } from "./report";
import { aiOutage } from "./scenarios/ai-outage";
import { disputeSettlement } from "./scenarios/dispute-settlement";
import { disputeWindowFinalize } from "./scenarios/dispute-window-finalize";
import { drawCancel } from "./scenarios/draw-cancel";
import { failedGraduation } from "./scenarios/failed-graduation";
import { happyPath } from "./scenarios/happy-path";
import { indexerRestart } from "./scenarios/indexer-restart";
import { manualReview } from "./scenarios/manual-review";
import { partialClearing } from "./scenarios/partial-clearing";

/**
 * Entry point for the lifecycle nightly suite (ADR 0017 Track C item C3;
 * ADR 0014 holds the scenario checklist). Requires a fully booted local
 * stack — chain, API, indexer, keeper, and the heuristic review/resolution
 * services — normally provided by `pnpm local:lifecycle-nightly`.
 *
 * Scenario order matters because chain-time jumps are global, forward-only,
 * and leave a PERMANENT chain-vs-wall offset (hardhat keeps jump offsets; they
 * never decay), while a scenario needing the resolution runner waits out
 * wall-clock time equal to its resolution window PLUS every offset accumulated
 * before its market was created — the runner's eligibility is `new Date()`,
 * which no jump can move. That coupling is quadratic in the number of
 * resolution-dependent scenarios, so the rule is: never jump a gate that is
 * already being waited out on the wall clock. The resolution-dependent
 * scenarios therefore jump nothing before their wait (see the note in
 * happy-path), which keeps each one's cost at its own window rather than its
 * window plus its predecessors'.
 *
 * The jumps that remain are the ones with no wall-clock counterpart, and they
 * are deliberately small and late: each dispute scenario closes its proposal
 * window by jumping to the deadline (bounded by that scenario's
 * DISPUTE_WINDOW_SECONDS), failed-graduation jumps its graduation deadline,
 * and partial clearing's graduation fast-forwards past the clearing challenge
 * deadline. Those offsets are permanent, so the resolution-dependent scenarios
 * still run FIRST and the rest trail them; appending a resolution-dependent
 * scenario after this group would put those offsets back into its wait.
 */
const SCENARIOS: readonly Scenario[] = [
  happyPath,
  drawCancel,
  disputeWindowFinalize,
  disputeSettlement,
  partialClearing,
  failedGraduation,
  manualReview,
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
