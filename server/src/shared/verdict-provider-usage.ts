import type { ProviderRunUsage } from "./verdict-run-log";

/**
 * Extracts per-run token and cost accounting from what each verdict backend
 * reports. Both verdict services drive the same backends and need the same
 * numbers, so the extraction lives here once rather than being copied per
 * service.
 *
 * Everything read here is untrusted and version-dependent: a field a backend
 * stops emitting must degrade to "not reported" rather than to a zero, because
 * a zero would read downstream as a genuinely free run.
 */

/**
 * Reads the token and cost accounting off the headless Claude CLI's terminal
 * result object. Both verdict services drive that CLI and both need the same
 * numbers, so the extraction lives here rather than being copied per service.
 *
 * The two services read different output formats — resolution takes the single
 * `--output-format json` envelope, review takes the `result` event out of the
 * `stream-json` transcript — but those are the same object, so one extractor
 * serves both.
 *
 * Field shapes verified against Claude Code 2.1.77 on 2026-08-10.
 */
export function usageFromClaudeCliResult(
  event: unknown,
): ProviderRunUsage | undefined {
  if (typeof event !== "object" || event === null) {
    return undefined;
  }

  const record = event as Record<string, unknown>;
  const usage = record.usage;
  const counts =
    typeof usage === "object" && usage !== null
      ? (usage as Record<string, unknown>)
      : {};

  const reported: ProviderRunUsage = {
    costUsd: numberOrUndefined(record.total_cost_usd),
    resolvedModel: soleModelUsageKey(record.modelUsage),
    tokens: {
      cacheReadInputTokens: numberOrUndefined(counts.cache_read_input_tokens),
      cacheWriteInputTokens: numberOrUndefined(
        counts.cache_creation_input_tokens,
      ),
      inputTokens: numberOrUndefined(counts.input_tokens),
      outputTokens: numberOrUndefined(counts.output_tokens),
    },
  };

  if (Object.values(reported.tokens ?? {}).every((v) => v === undefined)) {
    delete reported.tokens;
  }

  return Object.values(reported).every((value) => value === undefined)
    ? undefined
    : reported;
}

/**
 * The concrete model behind an alias. The CLI reports usage per model, so a
 * turn that spanned more than one leaves no single answer — report none rather
 * than picking the first and implying the whole run ran on it.
 */
function soleModelUsageKey(modelUsage: unknown): string | undefined {
  if (typeof modelUsage !== "object" || modelUsage === null) {
    return undefined;
  }

  const keys = Object.keys(modelUsage as Record<string, unknown>);
  return keys.length === 1 ? keys[0] : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Reads the `usage` block off an Anthropic Messages API response. Field names
 * are the documented wire names (`input_tokens`, `output_tokens`,
 * `cache_read_input_tokens`, `cache_creation_input_tokens`); the API reports no
 * per-request cost, so `costUsd` is left for the price table to derive.
 */
export function usageFromMessagesApiResponse(
  response: unknown,
): ProviderRunUsage | undefined {
  if (typeof response !== "object" || response === null) {
    return undefined;
  }

  const usage = (response as Record<string, unknown>).usage;
  if (typeof usage !== "object" || usage === null) {
    return undefined;
  }

  const counts = usage as Record<string, unknown>;
  const tokens = {
    cacheReadInputTokens: numberOrUndefined(counts.cache_read_input_tokens),
    cacheWriteInputTokens: numberOrUndefined(
      counts.cache_creation_input_tokens,
    ),
    inputTokens: numberOrUndefined(counts.input_tokens),
    outputTokens: numberOrUndefined(counts.output_tokens),
  };

  return Object.values(tokens).every((value) => value === undefined)
    ? undefined
    : { tokens };
}
