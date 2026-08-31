/**
 * Per-provider aggregates over the verdict-run telemetry lines a service wrote
 * (ADR 0027 item A3). Reads a log file, or stdin when no path is given, and
 * prints one row per (service, provider, model) with run counts, error rate,
 * latency percentiles, token totals, and cost.
 *
 * The point of this script is that it needs nothing but the log: no database,
 * no eval report, no vendor agent. Run it against a service's captured stdout
 * after an eval pass and the numbers for the Ledger row fall out.
 *
 *   bun run scripts/verdict-run-aggregate.ts eval-reports/review-service.log
 *   ... | bun run scripts/verdict-run-aggregate.ts
 *
 * Non-verdict lines are skipped, so pointing it at a whole service log is the
 * expected usage rather than a special case.
 */

import {
  parseVerdictRunLine,
  type VerdictRunRecord,
} from "../src/shared/verdict-run-log";

type Bucket = {
  costUsdTotal: number;
  errors: number;
  inputTokens: number;
  latenciesMs: number[];
  model: string;
  outcomes: Map<string, number>;
  outputTokens: number;
  provider: string;
  /** Concrete models the backend reported, when it named exactly one per run. */
  resolvedModels: Set<string>;
  /**
   * How many of this bucket's runs carried a cost. Reported alongside the total
   * so a partially-priced bucket cannot read as a complete one.
   */
  runsWithCost: number;
  service: string;
};

async function readInput(path: string | undefined): Promise<string> {
  if (path !== undefined) {
    return Bun.file(path).text();
  }
  return new Response(Bun.stdin.stream()).text();
}

/**
 * Buckets are keyed on the model the service ASKED for, not the one the backend
 * resolved. A backend that answers one run on a single model and another with a
 * helper model alongside reports a resolved model on the first and none on the
 * second; keying on that split one provider's runs across two buckets and
 * halved every count in the first proof run. The requested model is stable
 * across runs, which is what an aggregate needs - resolved models are reported
 * inside the bucket instead.
 */
function bucketKey(record: VerdictRunRecord): string {
  return [record.service, record.provider, record.model ?? "unknown"].join(" ");
}

function accumulate(records: VerdictRunRecord[]): Bucket[] {
  const buckets = new Map<string, Bucket>();

  for (const record of records) {
    const key = bucketKey(record);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        costUsdTotal: 0,
        errors: 0,
        inputTokens: 0,
        latenciesMs: [],
        model: record.model ?? "unknown",
        outcomes: new Map(),
        outputTokens: 0,
        provider: record.provider,
        resolvedModels: new Set(),
        runsWithCost: 0,
        service: record.service,
      };
      buckets.set(key, bucket);
    }

    bucket.latenciesMs.push(record.latencyMs);
    if (record.resolvedModel !== undefined) {
      bucket.resolvedModels.add(record.resolvedModel);
    }
    if (!record.ok) {
      bucket.errors += 1;
    }
    bucket.outcomes.set(
      record.outcome,
      (bucket.outcomes.get(record.outcome) ?? 0) + 1,
    );
    bucket.inputTokens += record.tokens?.inputTokens ?? 0;
    bucket.outputTokens += record.tokens?.outputTokens ?? 0;
    if (record.costUsd !== undefined) {
      bucket.costUsdTotal += record.costUsd;
      bucket.runsWithCost += 1;
    }
  }

  return [...buckets.values()].sort((a, b) =>
    `${a.service}${a.provider}${a.model}`.localeCompare(
      `${b.service}${b.provider}${b.model}`,
    ),
  );
}

/**
 * Nearest-rank percentile. A run count in the single digits is the normal case
 * for a bounded eval pass, and interpolation there invents precision the sample
 * does not have.
 */
export function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1] ?? 0;
}

function render(bucket: Bucket): string {
  const sorted = [...bucket.latenciesMs].sort((a, b) => a - b);
  const runs = sorted.length;
  const outcomes = [...bucket.outcomes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([outcome, count]) => `${outcome}=${count}`)
    .join(" ");
  const cost =
    bucket.runsWithCost === 0
      ? "cost unknown (no priced run)"
      : `cost $${bucket.costUsdTotal.toFixed(4)} over ${bucket.runsWithCost}/${runs} priced runs ` +
        `($${(bucket.costUsdTotal / bucket.runsWithCost).toFixed(4)}/run)`;

  const resolved =
    bucket.resolvedModels.size === 0
      ? "not reported"
      : [...bucket.resolvedModels].sort().join(", ");

  return [
    `${bucket.service} / ${bucket.provider} / ${bucket.model}`,
    `  runs ${runs}  errors ${bucket.errors}  resolved model ${resolved}`,
    `  latency p50 ${percentile(sorted, 0.5)}ms  p95 ${percentile(sorted, 0.95)}ms  max ${sorted[runs - 1] ?? 0}ms`,
    `  tokens in ${bucket.inputTokens}  out ${bucket.outputTokens}`,
    `  ${cost}`,
    `  outcomes ${outcomes}`,
  ].join("\n");
}

const [, , path] = Bun.argv;
const text = await readInput(path);
const records = text
  .split("\n")
  .map(parseVerdictRunLine)
  .filter((record): record is VerdictRunRecord => record !== null);

if (records.length === 0) {
  console.error("No verdict-run lines found.");
  process.exit(1);
}

const buckets = accumulate(records);
console.log(
  `${records.length} verdict runs across ${buckets.length} buckets\n`,
);
console.log(buckets.map(render).join("\n\n"));
