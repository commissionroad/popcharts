import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

import {
  compareReports,
  type EvalReportMetrics,
  type EvalSummary,
  loadReportMetrics,
  renderDeltaTable,
} from "./check-eval-regression";

const fixturePath = (name: string) =>
  resolve(import.meta.dirname, "fixtures", name);
const scriptPath = resolve(import.meta.dirname, "check-eval-regression.ts");

const baseline = loadReportMetrics(
  fixturePath("regression-check-baseline.json"),
);
const happyRun = loadReportMetrics(
  fixturePath("regression-check-run-happy.json"),
);
const regressedRun = loadReportMetrics(
  fixturePath("regression-check-run-regressed.json"),
);

function summary(overrides: Partial<EvalSummary> = {}): EvalSummary {
  return {
    accuracy: 0.9,
    cases: 10,
    strictAccuracy: 0.9,
    unanimousRate: 0.9,
    ...overrides,
  };
}

describe("compareReports", () => {
  it("passes a run within tolerance with intact guarded classes", () => {
    const result = compareReports(happyRun, baseline, 0.05);
    expect(result.failures).toEqual([]);
    expect(result.classDeltas).toHaveLength(3);
    expect(result.classDeltas.map((delta) => delta.taxonomy)).toEqual([
      "injection/embedded-instruction",
      "resolved/clear-yes",
      "vagueness/unmeasurable-threshold",
    ]);
  });

  it("fails on overall accuracy, strict accuracy, and guarded-class collapse", () => {
    const result = compareReports(regressedRun, baseline, 0.05);
    expect(result.failures).toHaveLength(3);
    expect(result.failures[0]).toContain("overall accuracy regressed");
    expect(result.failures[1]).toContain("overall strict accuracy regressed");
    expect(result.failures[2]).toContain(
      "guarded class injection/embedded-instruction collapsed",
    );
    const injection = result.classDeltas.find(
      (delta) => delta.taxonomy === "injection/embedded-instruction",
    );
    expect(injection?.hardGuardViolation).toBe(true);
  });

  it("treats a drop of exactly the tolerance as passing (only MORE fails)", () => {
    // 0.9 - 0.85 is 0.05000000000000004 in IEEE-754; the epsilon in the
    // comparison must absorb that, not flag it as "more than 0.05".
    const withOverall = (accuracy: number): EvalReportMetrics => ({
      classes: {},
      overall: summary({ accuracy, strictAccuracy: accuracy }),
    });
    const result = compareReports(withOverall(0.85), withOverall(0.9), 0.05);
    expect(result.failures).toEqual([]);
  });

  it("does not apply the guarded floor to classes below the guard threshold", () => {
    // vagueness/unmeasurable-threshold sits at 0.8 in the baseline: a fall to
    // 0.5 is not a guarded-class failure (only the overall tolerance can
    // catch it).
    const run: EvalReportMetrics = {
      classes: {
        "vagueness/unmeasurable-threshold": summary({ accuracy: 0.5 }),
      },
      overall: summary(),
    };
    const base: EvalReportMetrics = {
      classes: {
        "vagueness/unmeasurable-threshold": summary({ accuracy: 0.8 }),
      },
      overall: summary(),
    };
    const result = compareReports(run, base, 0.05);
    expect(result.failures).toEqual([]);
  });

  it("notes but does not fail baseline classes missing from the run", () => {
    const run: EvalReportMetrics = { classes: {}, overall: summary() };
    const base: EvalReportMetrics = {
      classes: { "injection/embedded-instruction": summary({ accuracy: 1 }) },
      overall: summary(),
    };
    const result = compareReports(run, base, 0.05);
    expect(result.failures).toEqual([]);
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toContain("injection/embedded-instruction");
    expect(result.classDeltas[0].run).toBeNull();
    expect(result.classDeltas[0].accuracyDelta).toBeNull();
  });
});

describe("renderDeltaTable", () => {
  it("includes overall rows and every baseline class", () => {
    const result = compareReports(regressedRun, baseline, 0.05);
    const table = renderDeltaTable(regressedRun, baseline, result);
    expect(table).toContain("OVERALL accuracy");
    expect(table).toContain("OVERALL strict");
    expect(table).toContain("injection/embedded-instruction");
    expect(table).toContain("guarded FAIL");
    expect(table).toContain("vagueness/unmeasurable-threshold");
  });
});

describe("CLI", () => {
  const runCli = (reportFixture: string) =>
    Bun.spawnSync(
      [
        process.execPath,
        scriptPath,
        "--report",
        fixturePath(reportFixture),
        "--baseline",
        fixturePath("regression-check-baseline.json"),
      ],
      { stderr: "pipe", stdout: "pipe" },
    );

  it("exits 0 and prints the delta table on a happy run", () => {
    const proc = runCli("regression-check-run-happy.json");
    expect(proc.exitCode).toBe(0);
    const stdout = proc.stdout.toString();
    expect(stdout).toContain("No regression against baseline.");
    expect(stdout).toContain("injection/embedded-instruction");
  });

  it("exits 1 and lists failures on a regressed run", () => {
    const proc = runCli("regression-check-run-regressed.json");
    expect(proc.exitCode).toBe(1);
    // The delta table still prints so the failure is diagnosable from logs.
    expect(proc.stdout.toString()).toContain("OVERALL accuracy");
    const stderr = proc.stderr.toString();
    expect(stderr).toContain("REGRESSION DETECTED");
    expect(stderr).toContain(
      "guarded class injection/embedded-instruction collapsed",
    );
  });

  it("exits 1 with usage when required flags are missing", () => {
    const proc = Bun.spawnSync([process.execPath, scriptPath], {
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(proc.exitCode).toBe(1);
    expect(proc.stderr.toString()).toContain("usage:");
  });
});
