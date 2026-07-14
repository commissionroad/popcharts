import { describe, expect, it } from "bun:test";

import type { AiReviewConfig } from "../config";
import { getReviewProviderStatus } from "./registry";

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
  retryProviderFailures: false,
  userAgent: "popcharts-test",
};

describe("review provider registry", () => {
  it("marks Anthropic unconfigured without its API key", () => {
    const status = getReviewProviderStatus({
      config: {
        ...baseConfig,
        provider: "anthropic",
      },
    });

    expect(status.name).toBe("anthropic");
    expect(status.configured).toBe(false);
    expect(status.capabilities.supportsNativeWebSearch).toBe(true);
    expect(status.capabilities.requiresPreCollectedEvidence).toBe(false);
    expect(status.validation.errors).toContain(
      "ANTHROPIC_API_KEY is required for Anthropic review.",
    );
  });

  it("allows Ollama startup config without probing local model reachability", () => {
    const status = getReviewProviderStatus({
      config: baseConfig,
    });

    expect(status.name).toBe("ollama");
    expect(status.configured).toBe(true);
    expect(status.capabilities.requiresLocalRuntime).toBe(true);
    expect(status.capabilities.requiresPreCollectedEvidence).toBe(true);
    expect(status.validation.errors).toEqual([]);
  });

  it("reports heuristic as always startup safe", () => {
    const status = getReviewProviderStatus({
      config: {
        ...baseConfig,
        provider: "heuristic",
      },
    });

    expect(status.name).toBe("heuristic");
    expect(status.configured).toBe(true);
    expect(status.capabilities.canRunOffline).toBe(true);
    expect(status.validation.errors).toEqual([]);
  });
});
