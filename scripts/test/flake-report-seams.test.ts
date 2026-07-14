import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { computeFlakeStats } from "../shared/flake-report/computeFlakeStats.ts";
import type { RawWorkflowRun } from "../shared/flake-report/normalizeRuns.ts";
import {
  FLAKE_REPORT_WORKFLOWS,
  normalizeRuns,
} from "../shared/flake-report/normalizeRuns.ts";
import { renderFlakesMarkdown } from "../shared/flake-report/renderFlakesMarkdown.ts";

const FIXTURE_RUNS = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "workflow-runs.json"), "utf8"),
) as RawWorkflowRun[];

const WINDOW = {
  windowStart: "2026-07-07T00:00:00Z",
  windowEnd: "2026-07-14T00:00:00Z",
  workflows: FLAKE_REPORT_WORKFLOWS,
};

describe("normalizeRuns", () => {
  it("maps snake_case API fields and defaults missing ones", () => {
    const [run] = normalizeRuns([{ name: "App CI" }]);
    assert.equal(run.workflowName, "App CI");
    assert.equal(run.runAttempt, 1);
    assert.equal(run.conclusion, null);
    assert.equal(run.status, "");
  });
});

describe("computeFlakeStats", () => {
  const stats = computeFlakeStats(normalizeRuns(FIXTURE_RUNS), WINDOW);
  const byName = new Map(stats.map((s) => [s.workflowName, s]));

  it("keeps the configured workflow order", () => {
    assert.deepEqual(
      stats.map((s) => s.workflowName),
      FLAKE_REPORT_WORKFLOWS,
    );
  });

  it("excludes cancelled, out-of-window, in-progress, and foreign runs", () => {
    // App CI fixture has 5 runs; only success + failure + rerun-pass count.
    assert.equal(byName.get("App CI")?.completedRuns, 3);
    // Protocol CI's in_progress run stays out.
    assert.equal(byName.get("Protocol CI")?.completedRuns, 1);
  });

  it("computes failure and flake rates with the rerun-pass signal", () => {
    const app = byName.get("App CI");
    assert.equal(app?.failures, 1);
    assert.equal(app?.failureRatePct, 33.33);
    assert.equal(app?.rerunPasses, 1);
    assert.equal(app?.flakeRatePct, 33.33);
    assert.equal(app?.wouldAlert, true);

    const protocol = byName.get("Protocol CI");
    assert.equal(protocol?.rerunPasses, 0);
    assert.equal(protocol?.flakeRatePct, 0);
    assert.equal(protocol?.wouldAlert, false);
  });

  it("yields null rates and no alert for a workflow with no runs", () => {
    const server = byName.get("Server CI");
    assert.equal(server?.completedRuns, 0);
    assert.equal(server?.failureRatePct, null);
    assert.equal(server?.flakeRatePct, null);
    assert.equal(server?.wouldAlert, false);
  });
});

describe("renderFlakesMarkdown", () => {
  const stats = computeFlakeStats(normalizeRuns(FIXTURE_RUNS), WINDOW);
  const markdown = renderFlakesMarkdown(stats, {
    generatedAt: WINDOW.windowEnd,
    windowStart: WINDOW.windowStart,
    windowEnd: WINDOW.windowEnd,
  });

  it("renders one table row per workflow with rates and threshold", () => {
    assert.match(
      markdown,
      /\| App CI \| 3 \| 1 \| 33\.3% \| 1 \| 33\.3% \| yes — would alert \|/,
    );
    assert.match(markdown, /\| Protocol CI \| 1 \| 0 \| 0\.0% \| 0 \| 0\.0% \| no \|/);
    assert.match(markdown, /\| Server CI \| 0 \| 0 \| n\/a \| 0 \| n\/a \| no \|/);
  });

  it("states the window and the report-only decision", () => {
    assert.ok(markdown.includes("2026-07-07T00:00:00Z → 2026-07-14T00:00:00Z"));
    assert.ok(markdown.includes("Informational only (ADR 0017)"));
  });
});
