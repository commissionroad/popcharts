import { describe, expect, it } from "bun:test";

import { reviewMarket } from "./reviewer";
import { buildReviewConfig } from "./test-support/review-config";

// Every provider here must be unreachable so the fallback paths are what the
// assertions see: a dead Ollama port, a model that does not exist, and a
// timeout short enough that the failure is instant.
const baseConfig = buildReviewConfig({
  internetAccess: "off",
  ollamaBaseUrl: "http://127.0.0.1:9",
  ollamaModel: "missing-model",
  provider: "heuristic",
  requestTimeoutMs: 10,
});

describe("reviewMarket", () => {
  it("can run as a heuristic-only local smoke", async () => {
    const result = await reviewMarket({
      config: baseConfig,
      request: {
        metadata: {
          question: "Will NASA announce a new Artemis launch date in 2026?",
          resolutionCriteria: "Resolve from a public NASA announcement.",
        },
      },
    });

    expect(result.provider).toBe("heuristic");
    expect(result.verdict).toBe("approve");
  });

  it("falls back to manual review when Ollama is unavailable", async () => {
    const result = await reviewMarket({
      config: {
        ...baseConfig,
        provider: "ollama",
      },
      request: {
        metadata: {
          question: "Will NASA announce a new Artemis launch date in 2026?",
          resolutionCriteria: "Resolve from a public NASA announcement.",
        },
      },
    });

    expect(result.provider).toBe("heuristic");
    expect(result.verdict).toBe("manual_review");
    expect(result.reasons.join("\n")).toContain("Ollama review unavailable");
  });

  it("surfaces provider failures for durable retry when configured", async () => {
    await expect(
      reviewMarket({
        config: {
          ...baseConfig,
          provider: "ollama",
          retryProviderFailures: true,
        },
        request: {
          metadata: {
            question: "Will NASA announce a new Artemis launch date in 2026?",
            resolutionCriteria: "Resolve from a public NASA announcement.",
          },
        },
      }),
    ).rejects.toMatchObject({ name: "ReviewUnavailableError" });
  });

  it("keeps the heuristic approve on fallback when fallbackApprove is set", async () => {
    const result = await reviewMarket({
      config: {
        ...baseConfig,
        fallbackApprove: true,
        provider: "ollama",
      },
      request: {
        metadata: {
          question: "Will NASA announce a new Artemis launch date in 2026?",
          resolutionCriteria: "Resolve from a public NASA announcement.",
        },
      },
    });

    expect(result.provider).toBe("heuristic");
    expect(result.verdict).toBe("approve");
    expect(result.reasons.join("\n")).toContain("Ollama review unavailable");
  });

  it("still rejects a hard-flagged market on fallback even with fallbackApprove", async () => {
    const result = await reviewMarket({
      config: {
        ...baseConfig,
        fallbackApprove: true,
        provider: "ollama",
      },
      request: {
        metadata: {
          question: "Will the mayor be assassinated before July?",
          resolutionCriteria: "Resolve from public news reports.",
        },
      },
    });

    expect(result.verdict).toBe("reject");
  });

  it("falls back to manual review when Anthropic is unavailable", async () => {
    const result = await reviewMarket({
      config: {
        ...baseConfig,
        provider: "anthropic",
      },
      request: {
        metadata: {
          question: "Will NASA announce a new Artemis launch date in 2026?",
          resolutionCriteria: "Resolve from a public NASA announcement.",
        },
      },
    });

    expect(result.provider).toBe("heuristic");
    expect(result.verdict).toBe("manual_review");
    expect(result.reasons.join("\n")).toContain("Anthropic review unavailable");
  });
});
