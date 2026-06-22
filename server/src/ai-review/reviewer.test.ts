import { describe, expect, it } from "bun:test";

import type { AiReviewConfig } from "./config";
import { reviewMarket } from "./reviewer";

const baseConfig: AiReviewConfig = {
  fetchSearchResults: false,
  internetAccess: "off",
  maxFetchBytes: 10_000,
  maxSearchResults: 3,
  ollamaBaseUrl: "http://127.0.0.1:9",
  ollamaModel: "missing-model",
  port: 3002,
  provider: "heuristic",
  requestTimeoutMs: 10,
  userAgent: "popcharts-test",
};

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
});
