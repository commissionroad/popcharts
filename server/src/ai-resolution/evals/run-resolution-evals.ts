/**
 * Offline resolution-outcome eval runner (ADR 0019), the resolution sibling
 * of `src/ai-review/evals/run-review-evals.ts`.
 *
 * Feeds the labeled seed dataset through a RUNNING resolution service's
 * `POST /resolutions/market` seam N times per case and reports:
 *   - accuracy: majority outcome lands in the case's acceptable set
 *   - strict accuracy: majority outcome equals the single expected outcome
 *   - consistency: fraction of cases where all N runs agree with each other
 * per taxonomy class and overall, plus a per-miss detail list.
 *
 * Cases are scored against the OUTCOME (yes/no/draw/too_early/abstain); the
 * derived on-chain verdict (resolve_yes/resolve_no/cancel_draw/
 * requeue_too_early/manual_review) also depends on the confidence/evidence
 * gates, so it is recorded per run but not graded.
 *
 * Usage (service must be running, e.g. the local stack's :3004 — see the
 * README in this directory for how to start an ad-hoc instance):
 *   bun run src/ai-resolution/evals/run-resolution-evals.ts \
 *     [--service-url http://127.0.0.1:3004] [--runs 3] \
 *     [--filter timing/] [--limit 10] [--out evals-report]
 *
 * The report is written as JSON + markdown next to --out (default
 * `server/eval-reports/<timestamp>-resolution`, gitignored). Deliberately
 * DB-free and chain-free: outcome quality is a service-level property.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { SERVICE_ERROR_HARD_FLAG } from "src/ai-resolution/resolver";
import type {
  ResolutionOutcome,
  ResolutionVerdict,
} from "src/ai-resolution/types";

import {
  acceptableOutcomes,
  ALL_RESOLUTION_EVAL_CASES,
  type ResolutionEvalCase,
} from "./dataset";

type CliOptions = {
  filter: string | null;
  limit: number | null;
  outBase: string;
  runs: number;
  serviceUrl: string;
};

type CaseResult = {
  agreementUnanimous: boolean;
  evalCase: ResolutionEvalCase;
  majority: ResolutionOutcome | null;
  correct: boolean;
  strictCorrect: boolean;
  outcomes: (ResolutionOutcome | "error")[];
  verdicts: (ResolutionVerdict | "error")[];
  confidences: (number | null)[];
  errors: string[];
  hardFlagRuns: number;
  latenciesMs: number[];
};

const options = parseCliOptions(process.argv.slice(2));

const selected = ALL_RESOLUTION_EVAL_CASES.filter(
  (candidate) =>
    !options.filter ||
    candidate.taxonomy.startsWith(options.filter) ||
    candidate.id.startsWith(options.filter),
).slice(0, options.limit ?? undefined);

if (selected.length === 0) {
  console.error(`No cases match filter "${options.filter}".`);
  process.exit(1);
}

const status = await probeService(options.serviceUrl);
console.log(
  `resolution service: ${options.serviceUrl} provider=${status.provider} prompt=${status.promptVersion ?? "?"} internet=${status.internetAccess ?? "?"}`,
);
console.log(
  `running ${selected.length} cases x ${options.runs} runs (${selected.length * options.runs} resolutions)\n`,
);

const results: CaseResult[] = [];
for (const [index, evalCase] of selected.entries()) {
  const outcomes: (ResolutionOutcome | "error")[] = [];
  const verdicts: (ResolutionVerdict | "error")[] = [];
  const confidences: (number | null)[] = [];
  const errors: string[] = [];
  const latenciesMs: number[] = [];
  let hardFlagRuns = 0;

  for (let run = 0; run < options.runs; run++) {
    const startedAt = Date.now();
    try {
      const resolution = await resolveOnce(options.serviceUrl, evalCase);
      outcomes.push(resolution.outcome);
      verdicts.push(resolution.verdict);
      confidences.push(resolution.confidence);
      if (resolution.hardFlags.length > 0) hardFlagRuns += 1;
    } catch (error) {
      outcomes.push("error");
      verdicts.push("error");
      confidences.push(null);
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      latenciesMs.push(Date.now() - startedAt);
    }
  }

  const majority = majorityOutcome(outcomes);
  const accepted = acceptableOutcomes(evalCase);
  const result: CaseResult = {
    agreementUnanimous:
      outcomes.every((outcome) => outcome === outcomes[0]) &&
      outcomes[0] !== "error",
    confidences,
    correct: majority !== null && accepted.includes(majority),
    errors,
    evalCase,
    hardFlagRuns,
    latenciesMs,
    majority,
    outcomes,
    strictCorrect: majority === evalCase.expected,
    verdicts,
  };
  results.push(result);

  const marker = result.correct ? "✓" : "✗";
  console.log(
    `${marker} [${index + 1}/${selected.length}] ${evalCase.id} expected=${evalCase.expected} got=${result.outcomes.join(",")} verdicts=${result.verdicts.join(",")}`,
  );
}

const report = buildReport(results, status, options);
const outJson = `${options.outBase}.json`;
const outMd = `${options.outBase}.md`;
mkdirSync(dirname(resolve(outJson)), { recursive: true });
writeFileSync(outJson, JSON.stringify(report, null, 2));
writeFileSync(outMd, renderMarkdown(report));
console.log(
  `\noverall: accuracy ${pct(report.overall.accuracy)} | strict ${pct(report.overall.strictAccuracy)} | unanimous ${pct(report.overall.unanimousRate)}`,
);
console.log(`report: ${outMd}`);

// ---------------------------------------------------------------------------

async function probeService(serviceUrl: string) {
  const response = await fetch(`${serviceUrl}/ready`);
  if (!response.ok)
    throw new Error(`service not ready: HTTP ${response.status}`);
  const body = (await response.json()) as {
    activeProvider?: string;
    internetAccess?: string;
    build?: { promptVersion?: string };
  };
  return {
    internetAccess: body.internetAccess ?? null,
    promptVersion: body.build?.promptVersion ?? null,
    provider: body.activeProvider ?? "unknown",
  };
}

async function resolveOnce(serviceUrl: string, evalCase: ResolutionEvalCase) {
  const response = await fetch(`${serviceUrl}/resolutions/market`, {
    body: JSON.stringify({ metadata: evalCase.metadata }),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(360_000),
  });
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`,
    );
  }
  const resolution = (await response.json()) as {
    confidence: number | null;
    hardFlags: string[];
    outcome: ResolutionOutcome;
    reasons?: string[];
    verdict: ResolutionVerdict;
  };
  // The service fail-safes provider outages/timeouts to abstain/manual_review
  // with the service-error hard flag (resolver.ts); for eval purposes that is
  // an errored run, not a judgment — counting it as an outcome silently
  // rewards prompts that make the model time out.
  if (resolution.hardFlags.includes(SERVICE_ERROR_HARD_FLAG)) {
    throw new Error(`provider unavailable: ${resolution.reasons?.[0] ?? ""}`);
  }
  return resolution;
}

function majorityOutcome(
  outcomes: (ResolutionOutcome | "error")[],
): ResolutionOutcome | null {
  const counts = new Map<ResolutionOutcome, number>();
  for (const outcome of outcomes) {
    if (outcome === "error") continue;
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  }
  let best: ResolutionOutcome | null = null;
  let bestCount = 0;
  for (const [outcome, count] of counts) {
    if (count > bestCount) {
      best = outcome;
      bestCount = count;
    }
  }
  return best;
}

function buildReport(
  caseResults: CaseResult[],
  status: Awaited<ReturnType<typeof probeService>>,
  cli: CliOptions,
) {
  const byClass = new Map<string, CaseResult[]>();
  for (const result of caseResults) {
    const list = byClass.get(result.evalCase.taxonomy) ?? [];
    list.push(result);
    byClass.set(result.evalCase.taxonomy, list);
  }

  const summarize = (list: CaseResult[]) => ({
    accuracy: ratio(list, (result) => result.correct),
    cases: list.length,
    strictAccuracy: ratio(list, (result) => result.strictCorrect),
    unanimousRate: ratio(list, (result) => result.agreementUnanimous),
  });

  return {
    classes: Object.fromEntries(
      [...byClass.entries()].map(([taxonomy, list]) => [
        taxonomy,
        summarize(list),
      ]),
    ),
    misses: caseResults
      .filter((result) => !result.correct)
      .map((result) => ({
        expected: result.evalCase.expected,
        acceptable: acceptableOutcomes(result.evalCase),
        id: result.evalCase.id,
        outcomes: result.outcomes,
        rationale: result.evalCase.rationale,
        taxonomy: result.evalCase.taxonomy,
        verdicts: result.verdicts,
      })),
    overall: summarize(caseResults),
    results: caseResults.map((result) => ({
      id: result.evalCase.id,
      taxonomy: result.evalCase.taxonomy,
      expected: result.evalCase.expected,
      outcomes: result.outcomes,
      verdicts: result.verdicts,
      confidences: result.confidences,
      majority: result.majority,
      correct: result.correct,
      strictCorrect: result.strictCorrect,
      unanimous: result.agreementUnanimous,
      hardFlagRuns: result.hardFlagRuns,
      latenciesMs: result.latenciesMs,
      errors: result.errors,
    })),
    service: status,
    settings: cli,
  };
}

function renderMarkdown(report: ReturnType<typeof buildReport>): string {
  const lines = [
    `# Resolution outcome eval — ${report.service.provider}, prompt ${report.service.promptVersion ?? "?"}`,
    "",
    `${report.overall.cases} cases × ${report.settings.runs} runs against ${report.settings.serviceUrl} (internet access: ${report.service.internetAccess ?? "?"})`,
    "",
    `| metric | value |`,
    `| --- | --- |`,
    `| accuracy (majority in acceptable set) | ${pct(report.overall.accuracy)} |`,
    `| strict accuracy (majority == expected) | ${pct(report.overall.strictAccuracy)} |`,
    `| unanimous cases (all runs agree) | ${pct(report.overall.unanimousRate)} |`,
    "",
    "## Per taxonomy class",
    "",
    "| class | cases | accuracy | strict | unanimous |",
    "| --- | --- | --- | --- | --- |",
    ...Object.entries(report.classes).map(
      ([taxonomy, summary]) =>
        `| ${taxonomy} | ${summary.cases} | ${pct(summary.accuracy)} | ${pct(summary.strictAccuracy)} | ${pct(summary.unanimousRate)} |`,
    ),
    "",
    "## Misses",
    "",
    ...(report.misses.length === 0
      ? ["None."]
      : report.misses.map(
          (miss) =>
            `- **${miss.id}** (${miss.taxonomy}): expected ${miss.expected} (acceptable: ${miss.acceptable.join("/")}), got outcomes [${miss.outcomes.join(", ")}] verdicts [${miss.verdicts.join(", ")}] — ${miss.rationale}`,
        )),
    "",
  ];
  return lines.join("\n");
}

function ratio(list: CaseResult[], predicate: (result: CaseResult) => boolean) {
  return list.length === 0 ? 0 : list.filter(predicate).length / list.length;
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function parseCliOptions(argv: string[]): CliOptions {
  const readValue = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const timestamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
  return {
    filter: readValue("--filter") ?? null,
    limit: readValue("--limit") ? Number(readValue("--limit")) : null,
    outBase:
      readValue("--out") ??
      resolve(
        import.meta.dirname,
        "../../../eval-reports",
        `${timestamp}-resolution`,
      ),
    runs: readValue("--runs") ? Number(readValue("--runs")) : 3,
    serviceUrl: readValue("--service-url") ?? "http://127.0.0.1:3004",
  };
}
