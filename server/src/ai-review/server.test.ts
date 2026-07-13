import { describe, expect, it } from "bun:test";

import type { AiReviewConfig } from "./config";
import { aiReviewApp, buildAiReviewRuntimeStatus } from "./server";

const baseConfig: AiReviewConfig = {
  anthropicBaseUrl: "https://api.anthropic.test",
  anthropicMaxOutputTokens: 512,
  anthropicMaxWebFetches: 1,
  anthropicMaxWebSearches: 1,
  anthropicModel: "claude-sonnet-4-6",
  anthropicWebFetchMaxContentTokens: 1_000,
  fallbackApprove: false,
  fetchSearchResults: false,
  internetAccess: "search",
  maxFetchBytes: 10_000,
  maxSearchResults: 3,
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "gpt-oss:20b",
  port: 3002,
  provider: "ollama",
  requestTimeoutMs: 100,
  userAgent: "popcharts-test",
};

describe("AI review runtime status", () => {
  it("keeps /health process-liveness separate from provider readiness", async () => {
    const response = await aiReviewApp.handle(
      new Request("http://localhost/health"),
    );
    const body = (await response.json()) as ReturnType<
      typeof buildAiReviewRuntimeStatus
    >;

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.providers.length).toBeGreaterThanOrEqual(3);
  });

  it("marks Anthropic ready when the key and caps are configured", () => {
    const status = buildAiReviewRuntimeStatus({
      ...baseConfig,
      anthropicApiKey: "test-key",
      provider: "anthropic",
    });

    expect(status.ready).toBe(true);
    expect(status.activeProvider).toBe("anthropic");
    expect(status.anthropic.apiKeyPresent).toBe(true);
    expect(status.nativeWebSearchEnabled).toBe(true);
    expect(status.preCollectedEvidenceEnabled).toBe(false);
    expect(JSON.stringify(status)).not.toContain("test-key");
  });

  it("marks Anthropic unready without exposing secret values", () => {
    const status = buildAiReviewRuntimeStatus({
      ...baseConfig,
      provider: "anthropic",
    });

    expect(status.ready).toBe(false);
    expect(status.anthropic.apiKeyPresent).toBe(false);
    expect(
      status.providers.find((provider) => provider.name === "anthropic")
        ?.validation.errors,
    ).toContain("ANTHROPIC_API_KEY is required for Anthropic review.");
  });
});
