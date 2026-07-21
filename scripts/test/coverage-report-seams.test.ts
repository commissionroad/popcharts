import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMENT_MARKER,
  emptyCommentPayload,
  parseCommentPayload,
  renderComment,
  upsertCommentEntry,
} from "../shared/coverage-report/coverageComment.ts";
import {
  appendHistory,
  badgeJson,
  historyRow,
  parseHistory,
  parseLatestCoverage,
  renderTrends,
  upsertLatestCoverage,
} from "../shared/coverage-report/coverageMetrics.ts";
import {
  COVERAGE_WORKSPACES,
  workspaceForKey,
  workspaceForWorkflow,
} from "../shared/coverage-report/coverageWorkspaces.ts";
import { parseLcovSummary } from "../shared/coverage-report/parseLcovSummary.ts";
import type { CoverageSummary } from "../shared/coverage-report/parseLcovSummary.ts";
import { parsePlaywrightReport } from "../shared/coverage-report/parsePlaywrightReport.ts";

const SAMPLE_LCOV = [
  "SF:src/api/routes/markets.ts",
  "FNF:4",
  "FNH:2",
  "LF:100",
  "LH:60",
  "BRF:10",
  "BRH:5",
  "end_of_record",
  "SF:../protocol/src/price/tickToSqrtPriceX96.ts",
  "FNF:2",
  "FNH:2",
  "LF:50",
  "LH:50",
  "end_of_record",
  "SF:./src/db/client.ts",
  "FNF:1",
  "FNH:0",
  "LF:20",
  "LH:0",
  "BRF:0",
  "BRH:0",
  "end_of_record",
].join("\n");

function summaryFixture(linesHit: number, linesFound: number): CoverageSummary {
  const pct =
    linesFound === 0 ? null : Math.round((linesHit / linesFound) * 10000) / 100;
  return {
    files: 1,
    lines: { hit: linesHit, found: linesFound, pct },
    functions: { hit: 1, found: 2, pct: 50 },
    branches: { hit: 0, found: 0, pct: null },
  };
}

describe("parseLcovSummary", () => {
  it("counts only records matching the include prefixes", () => {
    const summary = parseLcovSummary(SAMPLE_LCOV, {
      include: ["src/"],
      exclude: [],
    });
    assert.equal(summary.files, 2);
    assert.equal(summary.lines.found, 120);
    assert.equal(summary.lines.hit, 60);
    assert.equal(summary.lines.pct, 50);
    assert.equal(summary.functions.found, 5);
    assert.equal(summary.functions.hit, 2);
    assert.equal(summary.branches.pct, 50);
  });

  it("applies exclude prefixes after includes", () => {
    const summary = parseLcovSummary(SAMPLE_LCOV, {
      include: ["src/"],
      exclude: ["src/db/"],
    });
    assert.equal(summary.files, 1);
    assert.equal(summary.lines.found, 100);
    assert.equal(summary.lines.pct, 60);
  });

  it("returns null percentages when nothing matches", () => {
    const summary = parseLcovSummary(SAMPLE_LCOV, {
      include: ["contracts/"],
      exclude: [],
    });
    assert.equal(summary.files, 0);
    assert.equal(summary.lines.pct, null);
  });
});

describe("coverage workspaces", () => {
  it("maps every CI workflow name to a workspace", () => {
    assert.equal(workspaceForWorkflow("App CI")?.key, "app");
    assert.equal(workspaceForWorkflow("Server CI")?.key, "server");
    assert.equal(
      workspaceForWorkflow("Protocol CI")?.key,
      "protocol-solidity",
    );
    assert.equal(workspaceForWorkflow("Nope CI"), undefined);
  });

  it("keeps keys unique and resolvable", () => {
    const keys = COVERAGE_WORKSPACES.map((w) => w.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const key of keys) assert.equal(workspaceForKey(key)?.key, key);
  });
});

describe("coverage comment", () => {
  it("renders a comment whose payload round-trips", () => {
    const payload = upsertCommentEntry(
      emptyCommentPayload(),
      "server",
      { summary: summaryFixture(60, 100), headSha: "a".repeat(40), baseline: null },
    );
    const body = renderComment(payload);
    assert.ok(body.startsWith(COMMENT_MARKER));
    assert.ok(body.includes("60.00% (60/100)"));
    assert.ok(body.includes("no baseline yet"));
    assert.deepEqual(parseCommentPayload(body), payload);
  });

  it("adds a workspace without clobbering rows from other runs", () => {
    const first = renderComment(
      upsertCommentEntry(emptyCommentPayload(), "server", {
        summary: summaryFixture(60, 100),
        headSha: "a".repeat(40),
        baseline: { linesPct: 59.7, commit: "b".repeat(40) },
      }),
    );
    const merged = renderComment(
      upsertCommentEntry(parseCommentPayload(first), "app", {
        summary: summaryFixture(100, 100),
        headSha: "a".repeat(40),
        baseline: { linesPct: 100, commit: "b".repeat(40) },
      }),
    );
    assert.ok(merged.includes("| Server |"));
    assert.ok(merged.includes("| App |"));
    assert.ok(merged.includes("+0.30%"));
    assert.ok(merged.includes("+0.00%"));
  });

  it("flags regressions in the delta column", () => {
    const body = renderComment(
      upsertCommentEntry(emptyCommentPayload(), "server", {
        summary: summaryFixture(50, 100),
        headSha: "a".repeat(40),
        baseline: { linesPct: 59.7, commit: "b".repeat(40) },
      }),
    );
    assert.ok(body.includes("-9.70% 🔻"));
  });

  it("treats a body without a payload as empty", () => {
    assert.deepEqual(
      parseCommentPayload("just some comment"),
      emptyCommentPayload(),
    );
    assert.deepEqual(parseCommentPayload(null), emptyCommentPayload());
  });

  it("surfaces e2e retry data and round-trips it through the payload", () => {
    const flaky = renderComment(
      upsertCommentEntry(emptyCommentPayload(), "app", {
        summary: summaryFixture(100, 100),
        headSha: "a".repeat(40),
        baseline: null,
        e2e: { flaky: 2, total: 24 },
      }),
    );
    assert.ok(flaky.includes("**2 of 24** tests passed only on retry"));
    assert.equal(parseCommentPayload(flaky).workspaces.app?.e2e?.flaky, 2);

    const clean = renderComment(
      upsertCommentEntry(emptyCommentPayload(), "app", {
        summary: summaryFixture(100, 100),
        headSha: "a".repeat(40),
        baseline: null,
        e2e: { flaky: 0, total: 24 },
      }),
    );
    assert.ok(clean.includes("24 tests, none needed a retry"));

    const absent = renderComment(
      upsertCommentEntry(emptyCommentPayload(), "app", {
        summary: summaryFixture(100, 100),
        headSha: "a".repeat(40),
        baseline: null,
      }),
    );
    assert.ok(!absent.includes("E2E smoke"));
  });
});

describe("parsePlaywrightReport", () => {
  it("counts flaky and run tests from the stats block", () => {
    const report = JSON.stringify({
      stats: { expected: 20, unexpected: 1, flaky: 2, skipped: 3 },
    });
    assert.deepEqual(parsePlaywrightReport(report), { flaky: 2, total: 23 });
  });

  it("returns null for absent or non-report input", () => {
    assert.equal(parsePlaywrightReport(null), null);
    assert.equal(parsePlaywrightReport("not json"), null);
    assert.equal(parsePlaywrightReport("{}"), null);
  });
});

describe("coverage metrics", () => {
  it("appends history rows and round-trips them", () => {
    const row = historyRow(
      "app",
      "c".repeat(40),
      "2026-07-14T12:00:00Z",
      summaryFixture(99, 100),
    );
    const text = appendHistory(appendHistory(null, row), row);
    const rows = parseHistory(text);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.linesPct, 99);
  });

  it("skips malformed history rows instead of failing", () => {
    const rows = parseHistory('not json\n{"ts":"2026-07-14","workspace":"app","commit":"c","linesPct":1,"linesHit":1,"linesFound":100,"functionsPct":null,"branchesPct":null}\n');
    assert.equal(rows.length, 1);
  });

  it("upserts latest.json per workspace", () => {
    const latest = upsertLatestCoverage(
      parseLatestCoverage(null),
      "server",
      {
        commit: "d".repeat(40),
        updatedAt: "2026-07-14T12:00:00Z",
        summary: summaryFixture(60, 100),
      },
    );
    const reparsed = parseLatestCoverage(JSON.stringify(latest));
    assert.equal(reparsed.workspaces.server?.summary.lines.pct, 60);
  });

  it("colors badges by coverage tier", () => {
    assert.ok(badgeJson("app coverage", 99.97).includes("brightgreen"));
    assert.ok(badgeJson("server coverage", 59.7).includes('"color":"orange"'));
    assert.ok(badgeJson("x", null).includes("unknown"));
  });

  it("renders trends newest-first per workspace", () => {
    const older = historyRow("app", "1".repeat(40), "2026-07-13T12:00:00Z", summaryFixture(98, 100));
    const newer = historyRow("app", "2".repeat(40), "2026-07-14T12:00:00Z", summaryFixture(99, 100));
    const md = renderTrends([older, newer]);
    assert.ok(md.indexOf("2026-07-14") < md.indexOf("2026-07-13"));
    assert.ok(md.includes("## App"));
    assert.ok(!md.includes("## Server"));
  });
});
