import "./env";

import { closeDb } from "src/db/client";

import { runScenarios, type Scenario } from "./report";
import { disputeSettlement } from "./scenarios/dispute-settlement";
import { disputeWindowFinalize } from "./scenarios/dispute-window-finalize";
import { drawCancel } from "./scenarios/draw-cancel";
import { entryFee } from "./scenarios/entry-fee";
import { failedGraduation } from "./scenarios/failed-graduation";
import { happyPath } from "./scenarios/happy-path";
import { indexerRestart } from "./scenarios/indexer-restart";
import { partialClearing } from "./scenarios/partial-clearing";

/**
 * Entry point for the lifecycle nightly suite (ADR 0017 Track C item C3;
 * ADR 0014 holds the scenario checklist). Requires a fully booted local
 * stack — chain, API, indexer, keeper, and the heuristic review/resolution
 * services — normally provided by `pnpm local:lifecycle-nightly`.
 *
 * Scenario order no longer couples the scenarios to each other. It used to:
 * chain-time jumps were global and forward-only, so every jump left a
 * permanent chain-vs-wall offset that each later resolution-dependent
 * scenario had to wait out on top of its own window — a cost quadratic in the
 * number of such scenarios, which is why they all ran first. Nothing in the
 * suite jumps the chain clock any more (ADR 0028 G5): every gate is waited out
 * in real time, so no scenario can hand an offset to the next one and each one
 * costs exactly the windows it configures for itself.
 *
 * What that leaves is a wall-clock bill per scenario rather than a coupling:
 * the resolution-dependent scenarios pay their resolution window, and
 * failed-graduation, entry-fee's refund path, and dispute-window-finalize pay
 * their graduation deadline and dispute window. Keep the windows in
 * market-factory and the scenarios short; that, not the ordering, is what
 * keeps the suite inside its deadline below.
 */
const SCENARIOS: readonly Scenario[] = [
  happyPath,
  drawCancel,
  disputeWindowFinalize,
  disputeSettlement,
  partialClearing,
  failedGraduation,
  entryFee,
  indexerRestart,
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
