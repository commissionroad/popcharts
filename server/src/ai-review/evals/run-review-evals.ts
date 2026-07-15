/**
 * Offline review-verdict eval runner (ADR 0019).
 *
 * Feeds the labeled seed dataset through a RUNNING review service's
 * `POST /reviews/market` seam N times per case and reports:
 *   - accuracy: majority verdict lands in the case's acceptable set
 *   - strict accuracy: majority verdict equals the single expected verdict
 *   - consistency: fraction of cases where all N runs agree with each other
 * per taxonomy class and overall, plus a per-miss detail list.
 *
 * Usage (service must be running, e.g. the local stack's :3002):
 *   bun run src/ai-review/evals/run-review-evals.ts \
 *     [--service-url http://127.0.0.1:3002] [--runs 3] \
 *     [--filter timing/] [--limit 10] [--out evals-report]
 *
 * The report is written as JSON + markdown next to --out (default
 * `server/eval-reports/<timestamp>-review`). Deliberately DB-free and
 * chain-free: verdict quality is a service-level property.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { ReviewVerdict } from "src/ai-review/types";

import {
  acceptableVerdicts,
  ALL_REVIEW_EVAL_CASES,
  type ReviewEvalCase,
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
  evalCase: ReviewEvalCase;
  majority: ReviewVerdict | null;
  correct: boolean;
  strictCorrect: boolean;
  verdicts: (ReviewVerdict | "error")[];
  errors: string[];
  hardFlagRuns: number;
  latenciesMs: number[];
};

const options = parseCliOptions(process.argv.slice(2));

const selected = ALL_REVIEW_EVAL_CASES.filter(
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
  `review service: ${options.serviceUrl} provider=${status.provider} model=${status.model ?? "-"} prompt=${status.promptVersion ?? "?"}`,
);
console.log(
  `running ${selected.length} cases x ${options.runs} runs (${selected.length * options.runs} reviews)\n`,
);

const results: CaseResult[] = [];
for (const [index, evalCase] of selected.entries()) {
  const verdicts: (ReviewVerdict | "error")[] = [];
  const errors: string[] = [];
  const latenciesMs: number[] = [];
  let hardFlagRuns = 0;

  for (let run = 0; run < options.runs; run++) {
    const startedAt = Date.now();
    try {
      const review = await reviewOnce(options.serviceUrl, evalCase);
      verdicts.push(review.verdict);
      if (review.hardFlags.length > 0) hardFlagRuns += 1;
    } catch (error) {
      verdicts.push("error");
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      latenciesMs.push(Date.now() - startedAt);
    }
  }

  const majority = majorityVerdict(verdicts);
  const accepted = acceptableVerdicts(evalCase);
  const result: CaseResult = {
    agreementUnanimous:
      verdicts.every((verdict) => verdict === verdicts[0]) &&
      verdicts[0] !== "error",
    correct: majority !== null && accepted.includes(majority),
    errors,
    evalCase,
    hardFlagRuns,
    latenciesMs,
    majority,
    strictCorrect: majority === evalCase.expected,
    verdicts,
  };
  results.push(result);

  const marker = result.correct ? "✓" : "✗";
  console.log(
    `${marker} [${index + 1}/${selected.length}] ${evalCase.id} expected=${evalCase.expected} got=${result.verdicts.join(",")}`,
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
    model?: string;
    build?: { promptVersion?: string };
  };
  return {
    model: body.model ?? null,
    promptVersion: body.build?.promptVersion ?? null,
    provider: body.activeProvider ?? "unknown",
  };
}

async function reviewOnce(serviceUrl: string, evalCase: ReviewEvalCase) {
  const response = await fetch(`${serviceUrl}/reviews/market`, {
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
  const review = (await response.json()) as {
    hardFlags: string[];
    reasons?: string[];
    verdict: ReviewVerdict;
  };
  // The service fail-safes provider outages/timeouts to manual_review; for
  // eval purposes that is an errored run, not a judgment — counting it as a
  // verdict silently rewards prompts that make the model time out.
  const unavailable = (review.reasons ?? []).some((reason) =>
    /review unavailable/i.test(reason),
  );
  if (unavailable) {
    throw new Error(`provider unavailable: ${review.reasons?.[0] ?? ""}`);
  }
  return review;
}

function majorityVerdict(
  verdicts: (ReviewVerdict | "error")[],
): ReviewVerdict | null {
  const counts = new Map<ReviewVerdict, number>();
  for (const verdict of verdicts) {
    if (verdict === "error") continue;
    counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
  }
  let best: ReviewVerdict | null = null;
  let bestCount = 0;
  for (const [verdict, count] of counts) {
    if (count > bestCount) {
      best = verdict;
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
        acceptable: acceptableVerdicts(result.evalCase),
        id: result.evalCase.id,
        rationale: result.evalCase.rationale,
        taxonomy: result.evalCase.taxonomy,
        verdicts: result.verdicts,
      })),
    overall: summarize(caseResults),
    results: caseResults.map((result) => ({
      id: result.evalCase.id,
      taxonomy: result.evalCase.taxonomy,
      expected: result.evalCase.expected,
      verdicts: result.verdicts,
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
    `# Review verdict eval — ${report.service.provider} (${report.service.model ?? "?"}), prompt ${report.service.promptVersion ?? "?"}`,
    "",
    `${report.overall.cases} cases × ${report.settings.runs} runs against ${report.settings.serviceUrl}`,
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
            `- **${miss.id}** (${miss.taxonomy}): expected ${miss.expected} (acceptable: ${miss.acceptable.join("/")}), got [${miss.verdicts.join(", ")}] — ${miss.rationale}`,
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
        `${timestamp}-review`,
      ),
    runs: readValue("--runs") ? Number(readValue("--runs")) : 3,
    serviceUrl: readValue("--service-url") ?? "http://127.0.0.1:3002",
  };
}
