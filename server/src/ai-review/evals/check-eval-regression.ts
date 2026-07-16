/**
 * Eval-report regression check (ADR 0019 CI consistency lane).
 *
 * Compares a fresh run of `run-review-evals.ts` (its JSON report) against a
 * committed baseline from `baselines/` and fails when verdict quality
 * regressed:
 *   - overall accuracy or strict accuracy drops more than --tolerance below
 *     the baseline, or
 *   - any taxonomy class the baseline scored at effectively-perfect accuracy
 *     (>= 0.99 — the deterministic hard-flag classes like harm/* and
 *     injection/*) drops below 0.75. Those classes must never quietly decay,
 *     tolerance or not: a hard-flag miss is a terminal-reject policy bug.
 *
 * A per-class delta table is printed either way so trend eyeballing is free.
 *
 * Usage:
 *   bun run src/ai-review/evals/check-eval-regression.ts \
 *     --report eval-reports/<run>.json \
 *     --baseline src/ai-review/evals/baselines/<provider>.json \
 *     [--tolerance 0.05]
 *
 * Deliberately DB-free, chain-free, and network-free: two JSON files in,
 * a table and an exit code out.
 */
import { readFileSync } from "node:fs";

/** Per-class / overall metrics as written by run-review-evals.ts. */
export type EvalSummary = {
  accuracy: number;
  cases: number;
  strictAccuracy: number;
  unanimousRate: number;
};

/** The subset of the eval-report JSON this check reads. */
export type EvalReportMetrics = {
  classes: Record<string, EvalSummary>;
  overall: EvalSummary;
};

export type ClassDelta = {
  taxonomy: string;
  baseline: EvalSummary;
  /** Null when the class exists in the baseline but not in the run. */
  run: EvalSummary | null;
  /** run.accuracy - baseline.accuracy; null when the class is missing. */
  accuracyDelta: number | null;
  hardGuardViolation: boolean;
};

export type RegressionResult = {
  classDeltas: ClassDelta[];
  failures: string[];
  /** Non-failing observations (e.g. baseline classes absent from the run). */
  notices: string[];
};

/**
 * A baseline class at or above this accuracy is treated as a guarded
 * "must stay near-perfect" class (in practice the deterministic hard-flag
 * classes, which score 1.0).
 */
export const HARD_GUARD_BASELINE_ACCURACY = 0.99;
/** Guarded classes fail the check when the run's accuracy lands below this. */
export const HARD_GUARD_FLOOR = 0.75;

/**
 * Float slack so "drops more than tolerance" compares real regressions, not
 * IEEE-754 noise (0.9 - 0.85 > 0.05 is true in floating point).
 */
const EPSILON = 1e-9;

export function compareReports(
  run: EvalReportMetrics,
  baseline: EvalReportMetrics,
  tolerance: number,
): RegressionResult {
  const failures: string[] = [];
  const notices: string[] = [];

  const overallChecks: [label: string, key: "accuracy" | "strictAccuracy"][] = [
    ["overall accuracy", "accuracy"],
    ["overall strict accuracy", "strictAccuracy"],
  ];
  for (const [label, key] of overallChecks) {
    const drop = baseline.overall[key] - run.overall[key];
    if (drop > tolerance + EPSILON) {
      failures.push(
        `${label} regressed: ${pct(baseline.overall[key])} -> ${pct(run.overall[key])} ` +
          `(drop ${pct(drop)} exceeds tolerance ${pct(tolerance)})`,
      );
    }
  }

  const classDeltas: ClassDelta[] = Object.entries(baseline.classes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([taxonomy, baselineSummary]) => {
      const runSummary = run.classes[taxonomy] ?? null;
      const guarded = baselineSummary.accuracy >= HARD_GUARD_BASELINE_ACCURACY;
      let hardGuardViolation = false;

      if (runSummary === null) {
        notices.push(
          `class ${taxonomy} is in the baseline but not in the run report ` +
            `(filtered run?) — not compared`,
        );
      } else if (guarded && runSummary.accuracy < HARD_GUARD_FLOOR) {
        hardGuardViolation = true;
        failures.push(
          `guarded class ${taxonomy} collapsed: baseline ${pct(baselineSummary.accuracy)} ` +
            `(>= ${pct(HARD_GUARD_BASELINE_ACCURACY)}) -> run ${pct(runSummary.accuracy)} ` +
            `(< ${pct(HARD_GUARD_FLOOR)} floor)`,
        );
      }

      return {
        accuracyDelta:
          runSummary === null
            ? null
            : runSummary.accuracy - baselineSummary.accuracy,
        baseline: baselineSummary,
        hardGuardViolation,
        run: runSummary,
        taxonomy,
      };
    });

  for (const taxonomy of Object.keys(run.classes).sort()) {
    if (!(taxonomy in baseline.classes)) {
      notices.push(
        `class ${taxonomy} is new in the run (no baseline entry) — not compared`,
      );
    }
  }

  return { classDeltas, failures, notices };
}

export function renderDeltaTable(
  run: EvalReportMetrics,
  baseline: EvalReportMetrics,
  result: RegressionResult,
): string {
  const rows: string[][] = [
    ["class", "cases", "baseline", "run", "delta", "strict Δ", "note"],
  ];
  const overallRow = (
    label: string,
    key: "accuracy" | "strictAccuracy",
  ): string[] => [
    label,
    String(run.overall.cases),
    pct(baseline.overall[key]),
    pct(run.overall[key]),
    signedPct(run.overall[key] - baseline.overall[key]),
    "",
    "",
  ];
  rows.push(overallRow("OVERALL accuracy", "accuracy"));
  rows.push(overallRow("OVERALL strict", "strictAccuracy"));

  for (const delta of result.classDeltas) {
    const guarded =
      delta.baseline.accuracy >= HARD_GUARD_BASELINE_ACCURACY ? "guarded" : "";
    rows.push([
      delta.taxonomy,
      String(delta.run?.cases ?? delta.baseline.cases),
      pct(delta.baseline.accuracy),
      delta.run === null ? "—" : pct(delta.run.accuracy),
      delta.accuracyDelta === null ? "n/a" : signedPct(delta.accuracyDelta),
      delta.run === null
        ? "n/a"
        : signedPct(delta.run.strictAccuracy - delta.baseline.strictAccuracy),
      delta.hardGuardViolation
        ? "guarded FAIL"
        : delta.run === null
          ? "missing from run"
          : guarded,
    ]);
  }

  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map((row) => row[column].length)),
  );
  return rows
    .map((row, index) => {
      const line = row
        .map((cell, column) =>
          column === 0
            ? cell.padEnd(widths[column])
            : cell.padStart(widths[column]),
        )
        .join("  ");
      return index === 0
        ? `${line}\n${widths.map((width) => "-".repeat(width)).join("  ")}`
        : line;
    })
    .join("\n");
}

export function loadReportMetrics(path: string): EvalReportMetrics {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as EvalReportMetrics;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof parsed.overall?.accuracy !== "number" ||
    typeof parsed.overall?.strictAccuracy !== "number" ||
    typeof parsed.classes !== "object" ||
    parsed.classes === null
  ) {
    throw new Error(
      `${path} is not an eval report (expected overall.accuracy, ` +
        `overall.strictAccuracy, and classes as written by run-review-evals.ts)`,
    );
  }
  return parsed;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signedPct(value: number): string {
  const rendered = pct(Math.abs(value));
  return value < 0 ? `-${rendered}` : `+${rendered}`;
}

// ---------------------------------------------------------------------------

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const readValue = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const reportPath = readValue("--report");
  const baselinePath = readValue("--baseline");
  const tolerance = Number(readValue("--tolerance") ?? "0.05");

  if (!reportPath || !baselinePath) {
    console.error(
      "usage: bun run src/ai-review/evals/check-eval-regression.ts " +
        "--report <run.json> --baseline <baseline.json> [--tolerance 0.05]",
    );
    process.exit(1);
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    console.error(
      `--tolerance must be a non-negative number, got ${tolerance}`,
    );
    process.exit(1);
  }

  const run = loadReportMetrics(reportPath);
  const baseline = loadReportMetrics(baselinePath);
  const result = compareReports(run, baseline, tolerance);

  console.log(`report:   ${reportPath}`);
  console.log(`baseline: ${baselinePath}`);
  console.log(
    `tolerance: ${pct(tolerance)} on overall accuracy/strict accuracy\n`,
  );
  console.log(renderDeltaTable(run, baseline, result));

  if (result.notices.length > 0) {
    console.log("");
    for (const notice of result.notices) console.log(`note: ${notice}`);
  }

  if (result.failures.length > 0) {
    console.error("\nREGRESSION DETECTED:");
    for (const failure of result.failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log("\nNo regression against baseline.");
}
