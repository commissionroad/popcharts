/**
 * The per-run cost/latency/token record both verdict services emit (ADR 0027
 * item A3). One line per completed run, on stdout, so a bounded eval run can be
 * aggregated from the service log alone with no vendor agent and no database.
 *
 * Shaped after `operator-alert-log.ts`: a leading marker term no ordinary
 * chatter can trip, then one JSON object. Unlike that module there is no
 * external consumer to keep in sync — `scripts/verdict-run-aggregate.ts` reads
 * these lines back through `parseVerdictRunLine`, so the writer and the reader
 * share one definition and cannot drift.
 *
 * Keep this module dependency-free: the aggregator script loads it under tsx
 * rather than bun.
 */

/**
 * Leading token on every verdict-run record. Distinct from the operator-alert
 * marker so a metric filter on one can never match the other.
 */
export const VERDICT_RUN_MARKER = "POPCHARTS_VERDICT_RUN";

/** Which verdict service produced the run. */
export type VerdictRunService = "review" | "resolution";

/**
 * Token counts as the provider reported them. Every field is optional because
 * "the provider does not report this" and "the provider reported zero" are
 * different facts, and only the first may be absent — a derived cost computed
 * over an absent field would silently under-report.
 */
export type VerdictRunTokens = {
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
};

/**
 * What a provider reports about its own run, when it reports anything. Carried
 * on the provider finding and read at the service seam; it deliberately never
 * reaches `ReviewResult`/`ResolutionResult`, so adding a reporting provider
 * cannot change the services' public response shape.
 */
export type ProviderRunUsage = {
  /**
   * Cost the backend itself billed for this run. Preferred over the price
   * table whenever present: the backend knows its own rate card, discounts,
   * and cache accounting, and the table only approximates them.
   */
  costUsd?: number;
  /** Concrete model the backend used, when the request named an alias. */
  resolvedModel?: string;
  tokens?: VerdictRunTokens;
};

/** One completed verdict run. */
export type VerdictRunRecord = {
  /**
   * Where `costUsd` came from. `provider` means the backend billed the run and
   * told us the number; `priceTable` means we multiplied reported tokens by
   * `MODEL_TOKEN_PRICES`. Absent whenever `costUsd` is absent.
   */
  costSource?: "priceTable" | "provider";
  /** Omitted rather than zeroed when neither source can supply a number. */
  costUsd?: number;
  /**
   * Wall-clock for the whole run at the service seam — evidence collection,
   * provider call, and verdict derivation together. It is what a caller waits
   * for, not just the model's share.
   */
  latencyMs: number;
  /** Model the service asked for; may be an alias the backend resolves. */
  model?: string;
  /** False when the run fail-safed because the provider call itself failed. */
  ok: boolean;
  /** The service's own verdict term (`manual_review`, `approve`, ...). */
  outcome: string;
  promptVersion: string;
  provider: string;
  /** Concrete model the backend reported using, when it reports one. */
  resolvedModel?: string;
  service: VerdictRunService;
  tokens?: VerdictRunTokens;
};

/**
 * Per-million-token list prices, keyed by the model id the provider reports.
 *
 * Only models whose price we can cite belong here. A model with no entry yields
 * no derived cost at all rather than a zero, so an un-priced backend shows up
 * in an aggregate as "cost unknown" instead of "cost free" — the failure mode
 * that makes a price table worse than none.
 *
 * Source: Anthropic public list pricing, recorded 2026-08-10. Re-check against
 * the pricing page when `PRICES_RECORDED_ON` goes stale; this table is a local
 * record of an external number and drifts by nature.
 */
export const PRICES_RECORDED_ON = "2026-08-10";

export const MODEL_TOKEN_PRICES: Readonly<
  Record<string, { inputPerMTok: number; outputPerMTok: number }>
> = {
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
};

/**
 * Cache reads bill at a fraction of the base input rate and cache writes at a
 * premium over it. Expressed as multipliers rather than four more columns per
 * model so a new model needs only its two base rates.
 */
const CACHE_READ_RATE_MULTIPLIER = 0.1;
const CACHE_WRITE_RATE_MULTIPLIER = 1.25;

/**
 * Cost of one run from reported tokens, or undefined when the model is not in
 * the price table. Absent token fields contribute nothing — see
 * `VerdictRunTokens`.
 */
export function deriveCostUsd(
  model: string | undefined,
  tokens: VerdictRunTokens | undefined,
): number | undefined {
  if (model === undefined || tokens === undefined) {
    return undefined;
  }

  const price = MODEL_TOKEN_PRICES[model];
  if (!price) {
    return undefined;
  }

  const millionths =
    (tokens.inputTokens ?? 0) * price.inputPerMTok +
    (tokens.outputTokens ?? 0) * price.outputPerMTok +
    (tokens.cacheReadInputTokens ?? 0) *
      price.inputPerMTok *
      CACHE_READ_RATE_MULTIPLIER +
    (tokens.cacheWriteInputTokens ?? 0) *
      price.inputPerMTok *
      CACHE_WRITE_RATE_MULTIPLIER;

  return millionths / 1_000_000;
}

/**
 * Renders one record: the marker term, then the JSON object. Undefined fields
 * are dropped by `JSON.stringify`, which is what keeps "not reported" distinct
 * from "reported zero" on the wire.
 */
export function formatVerdictRun(record: VerdictRunRecord): string {
  return `${VERDICT_RUN_MARKER} ${JSON.stringify(record)}`;
}

/**
 * Reads one log line back into a record, or null when the line is not a verdict
 * run. Service logs interleave these with arbitrary other output, so anything
 * unrecognized is skipped rather than assumed well-formed.
 */
export function parseVerdictRunLine(line: string): VerdictRunRecord | null {
  const marked = line.indexOf(VERDICT_RUN_MARKER);
  if (marked < 0) {
    return null;
  }

  const payload = line.slice(marked + VERDICT_RUN_MARKER.length).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const candidate = parsed as Partial<VerdictRunRecord>;
  if (
    (candidate.service !== "review" && candidate.service !== "resolution") ||
    typeof candidate.provider !== "string" ||
    typeof candidate.promptVersion !== "string" ||
    typeof candidate.outcome !== "string" ||
    typeof candidate.latencyMs !== "number" ||
    typeof candidate.ok !== "boolean"
  ) {
    return null;
  }

  return candidate as VerdictRunRecord;
}

/** Everything a service seam knows about a run it just finished. */
export type VerdictRunInput = {
  latencyMs: number;
  model: string | undefined;
  ok: boolean;
  outcome: string;
  promptVersion: string;
  provider: string;
  service: VerdictRunService;
  usage?: ProviderRunUsage;
};

/**
 * Emits one per-run telemetry line for a completed verdict run.
 *
 * Cost comes from the backend when it bills the run itself and from
 * `MODEL_TOKEN_PRICES` otherwise; when neither can supply a number the field is
 * absent rather than zero, so an un-priced backend aggregates as "cost unknown"
 * and never as "free".
 *
 * `latencyMs` is rounded here so every emitter reports the same precision.
 */
export function logVerdictRun(run: VerdictRunInput): void {
  console.log(formatVerdictRun(buildVerdictRun(run)));
}

/** The record `logVerdictRun` writes, split out so tests can assert its shape. */
export function buildVerdictRun({
  latencyMs,
  model,
  ok,
  outcome,
  promptVersion,
  provider,
  service,
  usage,
}: VerdictRunInput): VerdictRunRecord {
  const resolvedModel = usage?.resolvedModel;
  const derivedCostUsd = deriveCostUsd(resolvedModel ?? model, usage?.tokens);
  const costUsd = usage?.costUsd ?? derivedCostUsd;

  return {
    costSource:
      costUsd === undefined
        ? undefined
        : usage?.costUsd === undefined
          ? "priceTable"
          : "provider",
    costUsd,
    latencyMs: Math.round(latencyMs),
    model,
    ok,
    outcome,
    promptVersion,
    provider,
    resolvedModel,
    service,
    tokens: usage?.tokens,
  };
}
