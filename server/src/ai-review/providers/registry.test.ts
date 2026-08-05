import { describe, expect, it } from "bun:test";

import { buildReviewConfig } from "../test-support/review-config";
import { getReviewProviderStatus } from "./registry";

const baseConfig = buildReviewConfig();

describe("review provider registry", () => {
  it("reports Claude CLI as subscription-backed native web search", () => {
    const status = getReviewProviderStatus({
      config: {
        ...baseConfig,
        provider: "claude-cli",
      },
    });

    expect(status.name).toBe("claude-cli");
    expect(status.model).toBe("sonnet");
    expect(status.configured).toBe(true);
    expect(status.capabilities.requiresApiKey).toBe(false);
    expect(status.capabilities.requiresLocalRuntime).toBe(true);
    expect(status.capabilities.supportsNativeWebSearch).toBe(true);
    expect(status.capabilities.requiresPreCollectedEvidence).toBe(false);
  });

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
