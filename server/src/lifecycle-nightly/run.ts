import "./env";

import { closeDb } from "src/db/client";

import { runScenarios, type Scenario } from "./report";
import { happyPath } from "./scenarios/happy-path";

/**
 * Entry point for the lifecycle nightly suite (ADR 0017 Track C item C3;
 * ADR 0014 holds the scenario checklist). Requires a fully booted local
 * stack — chain, API, indexer, keeper, and the heuristic review/resolution
 * services — normally provided by `pnpm local:lifecycle-nightly`.
 *
 * Scenario order matters twice over: chain-time jumps are global and
 * forward-only, and scenarios needing an AI runner to pick a market up wait
 * out real wall-clock time that grows with accumulated chain drift — so
 * runner-dependent scenarios come first, while drift is smallest.
 */
const SCENARIOS: readonly Scenario[] = [happyPath];

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
// wait) would otherwise park the runner until the CI job's 45-minute kill
// with no summary; the hard deadline turns any hang into a loud failure.
const suiteTimeoutMs = Number(
  process.env.POPCHARTS_LIFECYCLE_SUITE_TIMEOUT_MS ?? 30 * 60 * 1000,
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
