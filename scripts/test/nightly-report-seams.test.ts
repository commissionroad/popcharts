import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { historyRow } from "../shared/coverage-report/coverageMetrics.ts";
import type { CoverageSummary } from "../shared/coverage-report/parseLcovSummary.ts";
import {
  deriveConclusion,
  latestNightlyOf,
  parseLatestNightly,
  parseNightlyHistory,
  renderNightlySection,
  serializeNightlyHistory,
  upsertNightlyHistory,
  type NightlyRun,
  type NightlySuiteResults,
} from "../shared/nightly-report/nightlyMetrics.ts";
import { renderTrends } from "../shared/trends/renderTrends.ts";

const GREEN: NightlySuiteResults = {
  smoke: "success",
  scenarios: "success",
  chainE2e: "success",
  terminal: "success",
};

function run(overrides: Partial<NightlyRun> = {}): NightlyRun {
  const suites = overrides.suites ?? GREEN;
  const runId = overrides.runId ?? "100";
  return {
    runId,
    ts: "2026-07-24T11:06:00Z",
    commit: "a".repeat(40),
    runUrl: `https://example.test/runs/${runId}`,
    conclusion: deriveConclusion(suites),
    suites,
    ...overrides,
  };
}

describe("nightlyMetrics", () => {
  it("is green only when every suite is green", () => {
    assert.equal(deriveConclusion(GREEN), "success");
    assert.equal(deriveConclusion({ ...GREEN, terminal: "cancelled" }), "failed");
    assert.equal(deriveConclusion({ ...GREEN, smoke: "failure" }), "failed");
    assert.equal(deriveConclusion({ ...GREEN, scenarios: "skipped" }), "failed");
  });

  it("upserts history by run id, keeping it sorted by time", () => {
    const first = run({ runId: "1", ts: "2026-07-22T11:00:00Z" });
    const second = run({ runId: "2", ts: "2026-07-23T11:00:00Z" });
    // A rerun of run 1 (same id, later completion) must replace, not duplicate.
    const rerun = run({ runId: "1", ts: "2026-07-22T12:30:00Z" });

    let rows = upsertNightlyHistory([], first);
    rows = upsertNightlyHistory(rows, second);
    rows = upsertNightlyHistory(rows, rerun);

    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => r.runId),
      ["1", "2"],
    );
    assert.equal(rows[0]?.ts, "2026-07-22T12:30:00Z");
  });

  it("keeps the newer run as latest, never regressing on an older write", () => {
    const older = run({ runId: "1", ts: "2026-07-22T11:00:00Z" });
    const newer = run({ runId: "2", ts: "2026-07-23T11:00:00Z" });
    assert.equal(latestNightlyOf(null, older).runId, "1");
    assert.equal(latestNightlyOf(older, newer).runId, "2");
    assert.equal(latestNightlyOf(newer, older).runId, "2");
  });

  it("treats an empty, malformed, or wrong-shape latest file as no run", () => {
    assert.equal(parseLatestNightly(null).run, null);
    assert.equal(parseLatestNightly("{ not json").run, null);
    assert.equal(parseLatestNightly('{"version":2,"run":{}}').run, null);
    // Valid JSON, wrong version — no run.
    assert.equal(parseLatestNightly('{"version":1,"run":null}').run, null);
    // Valid JSON, right version, but the run is a stale/foreign shape — dropped.
    assert.equal(
      parseLatestNightly('{"version":1,"run":{"runId":"1","ts":"x"}}').run,
      null,
    );
  });

  it("round-trips history and drops rows that are valid JSON but wrong-shape", () => {
    const rows = [run({ runId: "1" }), run({ runId: "2" })];
    const parsed = parseNightlyHistory(serializeNightlyHistory(rows));
    assert.deepEqual(parsed, rows);
    assert.equal(serializeNightlyHistory([]), "");

    // A syntactically valid line of the wrong shape is skipped, not crashed on,
    // so one bad row never takes down the render.
    const withJunk = `${JSON.stringify(rows[0])}\n{"unexpected":true}\n${JSON.stringify(rows[1])}\n`;
    assert.deepEqual(parseNightlyHistory(withJunk), rows);
  });

  it("renders newest-first and links the result to its run", () => {
    const failed = run({
      runId: "1",
      ts: "2026-07-22T11:00:00Z",
      suites: { ...GREEN, terminal: "cancelled" },
      conclusion: "failed",
      runUrl: "https://example.test/runs/1",
    });
    const passed = run({ runId: "2", ts: "2026-07-23T11:00:00Z" });
    const md = renderNightlySection([failed, passed]);

    assert.ok(md.includes("## Nightly lifecycle"));
    assert.ok(md.indexOf("2026-07-23") < md.indexOf("2026-07-22"));
    assert.ok(md.includes("[✗ fail](https://example.test/runs/1)"));
    assert.ok(md.includes("[✓ pass](https://example.test/runs/2)"));
    // The cancelled suite renders as its own mark, not a pass.
    assert.ok(md.includes("⊘"));
    // A column per suite, sourced from the shared suite list.
    assert.ok(md.includes("UI journeys"));
  });

  it("omits the section entirely before the first run", () => {
    assert.equal(renderNightlySection([]), "");
  });
});

describe("renderTrends composition", () => {
  const summary: CoverageSummary = {
    files: 1,
    lines: { hit: 100, found: 100, pct: 100 },
    functions: { hit: 1, found: 2, pct: 50 },
    branches: { hit: 0, found: 0, pct: null },
  };
  const coverage = [historyRow("app", "c".repeat(40), "2026-07-24T00:00:00Z", summary)];

  it("puts the nightly section above coverage", () => {
    const md = renderTrends(coverage, [run()]);
    assert.ok(md.includes("# CI trends"));
    assert.ok(md.indexOf("## Nightly lifecycle") < md.indexOf("## App"));
  });

  it("renders coverage-only with no nightly section", () => {
    const md = renderTrends(coverage, []);
    assert.ok(md.includes("## App"));
    assert.ok(!md.includes("## Nightly lifecycle"));
  });

  it("renders nightly-only before any coverage lands", () => {
    const md = renderTrends([], [run()]);
    assert.ok(md.includes("## Nightly lifecycle"));
    assert.ok(!md.includes("## App"));
  });
});
