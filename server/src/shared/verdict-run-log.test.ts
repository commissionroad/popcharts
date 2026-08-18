import { describe, expect, test } from "bun:test";

import {
  usageFromClaudeCliResult,
  usageFromMessagesApiResponse,
} from "./verdict-provider-usage";
import {
  buildVerdictRun,
  deriveCostUsd,
  formatVerdictRun,
  MODEL_TOKEN_PRICES,
  parseVerdictRunLine,
  VERDICT_RUN_MARKER,
} from "./verdict-run-log";

const PRICED_MODEL = "claude-sonnet-4-6";

describe("formatVerdictRun", () => {
  test("renders the marker then one JSON object", () => {
    const line = formatVerdictRun({
      latencyMs: 1234,
      ok: true,
      outcome: "manual_review",
      promptVersion: "v1",
      provider: "claude-cli",
      service: "resolution",
    });

    expect(line.startsWith(`${VERDICT_RUN_MARKER} {`)).toBe(true);
    expect(line.split("\n")).toHaveLength(1);
    expect(JSON.parse(line.slice(VERDICT_RUN_MARKER.length))).toEqual({
      latencyMs: 1234,
      ok: true,
      outcome: "manual_review",
      promptVersion: "v1",
      provider: "claude-cli",
      service: "resolution",
    });
  });

  test("omits unreported fields rather than zeroing them", () => {
    const line = formatVerdictRun({
      latencyMs: 5,
      ok: false,
      outcome: "manual_review",
      promptVersion: "v1",
      provider: "ollama",
      service: "review",
    });

    expect(line).not.toContain("costUsd");
    expect(line).not.toContain("tokens");
  });
});

describe("parseVerdictRunLine", () => {
  test("round-trips a record written by formatVerdictRun", () => {
    const record = buildVerdictRun({
      latencyMs: 42.6,
      model: "sonnet",
      ok: true,
      outcome: "approve",
      promptVersion: "v3",
      provider: "claude-cli",
      service: "review",
      usage: {
        costUsd: 0.0325,
        resolvedModel: PRICED_MODEL,
        tokens: { inputTokens: 3, outputTokens: 4 },
      },
    });

    expect(parseVerdictRunLine(formatVerdictRun(record))).toEqual(record);
  });

  test("finds the record when the runtime prefixes the line", () => {
    const line = formatVerdictRun({
      latencyMs: 1,
      ok: true,
      outcome: "approve",
      promptVersion: "v3",
      provider: "heuristic",
      service: "review",
    });

    expect(parseVerdictRunLine(`2026-08-10T00:00:00Z info ${line}`)).not.toBe(
      null,
    );
  });

  test.each([
    ["unrelated chatter", "server listening on 3998"],
    ["marker with unparseable payload", `${VERDICT_RUN_MARKER} {oops`],
    [
      "marker with a foreign service",
      `${VERDICT_RUN_MARKER} {"service":"billing","provider":"x","promptVersion":"v1","outcome":"o","latencyMs":1,"ok":true}`,
    ],
    [
      "marker missing a required field",
      `${VERDICT_RUN_MARKER} {"service":"review","provider":"x","promptVersion":"v1","outcome":"o","latencyMs":1}`,
    ],
  ])("skips %s", (_label, line) => {
    expect(parseVerdictRunLine(line)).toBe(null);
  });
});

describe("deriveCostUsd", () => {
  test("prices reported tokens at the table's per-million rates", () => {
    const price = MODEL_TOKEN_PRICES[PRICED_MODEL];
    expect(price).toBeDefined();

    expect(
      deriveCostUsd(PRICED_MODEL, {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(price!.inputPerMTok + price!.outputPerMTok, 10);
  });

  test("bills cache reads below and cache writes above the input rate", () => {
    const read = deriveCostUsd(PRICED_MODEL, {
      cacheReadInputTokens: 1_000_000,
    })!;
    const write = deriveCostUsd(PRICED_MODEL, {
      cacheWriteInputTokens: 1_000_000,
    })!;
    const base = deriveCostUsd(PRICED_MODEL, { inputTokens: 1_000_000 })!;

    expect(read).toBeLessThan(base);
    expect(write).toBeGreaterThan(base);
  });

  test("returns undefined for an unpriced model rather than zero", () => {
    expect(
      deriveCostUsd("gpt-oss:20b", { inputTokens: 1_000, outputTokens: 1_000 }),
    ).toBeUndefined();
    expect(deriveCostUsd(undefined, { inputTokens: 1_000 })).toBeUndefined();
  });
});

describe("buildVerdictRun", () => {
  test("prefers the provider's own cost and labels its source", () => {
    const record = buildVerdictRun({
      latencyMs: 10,
      model: "sonnet",
      ok: true,
      outcome: "approve",
      promptVersion: "v3",
      provider: "claude-cli",
      service: "review",
      usage: {
        costUsd: 0.5,
        resolvedModel: PRICED_MODEL,
        tokens: { inputTokens: 10, outputTokens: 10 },
      },
    });

    expect(record.costUsd).toBe(0.5);
    expect(record.costSource).toBe("provider");
    expect(record.resolvedModel).toBe(PRICED_MODEL);
  });

  test("falls back to the price table against the resolved model", () => {
    const record = buildVerdictRun({
      latencyMs: 10,
      model: "sonnet",
      ok: true,
      outcome: "approve",
      promptVersion: "v3",
      provider: "anthropic",
      service: "review",
      usage: {
        resolvedModel: PRICED_MODEL,
        tokens: { inputTokens: 1_000_000, outputTokens: 0 },
      },
    });

    expect(record.costSource).toBe("priceTable");
    expect(record.costUsd).toBeCloseTo(
      MODEL_TOKEN_PRICES[PRICED_MODEL]!.inputPerMTok,
      10,
    );
  });

  test("leaves cost and its source absent when neither can supply one", () => {
    const record = buildVerdictRun({
      latencyMs: 10,
      model: "gpt-oss:20b",
      ok: true,
      outcome: "approve",
      promptVersion: "v3",
      provider: "ollama",
      service: "review",
      usage: { tokens: { inputTokens: 500 } },
    });

    expect(record.costUsd).toBeUndefined();
    expect(record.costSource).toBeUndefined();
  });

  test("rounds latency so every emitter reports one precision", () => {
    expect(
      buildVerdictRun({
        latencyMs: 12.7,
        model: undefined,
        ok: false,
        outcome: "manual_review",
        promptVersion: "v1",
        provider: "claude-cli",
        service: "resolution",
      }).latencyMs,
    ).toBe(13);
  });
});

describe("usageFromClaudeCliResult", () => {
  // Field-for-field copy of a real terminal result object, trimmed to the keys
  // this extractor reads (Claude Code 2.1.77, observed 2026-08-10).
  const REAL_RESULT = {
    duration_ms: 2362,
    is_error: false,
    modelUsage: { [PRICED_MODEL]: { costUSD: 0.03273525 } },
    result: "ok",
    total_cost_usd: 0.03273525,
    type: "result",
    usage: {
      cache_creation_input_tokens: 8711,
      cache_read_input_tokens: 0,
      input_tokens: 3,
      output_tokens: 4,
    },
  };

  test("reads cost, resolved model, and every token count", () => {
    expect(usageFromClaudeCliResult(REAL_RESULT)).toEqual({
      costUsd: 0.03273525,
      resolvedModel: PRICED_MODEL,
      tokens: {
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 8711,
        inputTokens: 3,
        outputTokens: 4,
      },
    });
  });

  test("keeps a reported zero distinct from an absent count", () => {
    const usage = usageFromClaudeCliResult({
      usage: { cache_read_input_tokens: 0 },
    });

    expect(usage?.tokens?.cacheReadInputTokens).toBe(0);
    expect(usage?.tokens?.inputTokens).toBeUndefined();
  });

  test("reports no resolved model when the run spanned more than one", () => {
    expect(
      usageFromClaudeCliResult({
        modelUsage: { [PRICED_MODEL]: {}, "claude-haiku-4-5": {} },
        total_cost_usd: 1,
      })?.resolvedModel,
    ).toBeUndefined();
  });

  test.each([
    ["a non-object", "result"],
    ["an envelope with no accounting", { is_error: false, result: "ok" }],
    ["a null usage block", { usage: null }],
  ])("returns undefined for %s", (_label, event) => {
    expect(usageFromClaudeCliResult(event)).toBeUndefined();
  });
});

describe("usageFromMessagesApiResponse", () => {
  test("maps the documented wire field names", () => {
    expect(
      usageFromMessagesApiResponse({
        model: PRICED_MODEL,
        usage: {
          cache_creation_input_tokens: 1024,
          cache_read_input_tokens: 512,
          input_tokens: 100,
          output_tokens: 200,
        },
      }),
    ).toEqual({
      tokens: {
        cacheReadInputTokens: 512,
        cacheWriteInputTokens: 1024,
        inputTokens: 100,
        outputTokens: 200,
      },
    });
  });

  test("returns undefined when the response carries no usage block", () => {
    expect(
      usageFromMessagesApiResponse({ model: PRICED_MODEL }),
    ).toBeUndefined();
  });
});
