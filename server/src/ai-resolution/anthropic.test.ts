import { afterEach, describe, expect, it } from "bun:test";

import { resolveWithAnthropic } from "./anthropic";
import { aiResolutionConfig } from "./config";
import { anthropicProvider } from "./providers/anthropic";
import type { MarketResolutionRequest } from "./types";

const config = {
  anthropicApiKey: "test-key",
  anthropicBaseUrl: "https://api.anthropic.test",
  anthropicMaxOutputTokens: 2_048,
  anthropicMaxWebFetches: 2,
  anthropicMaxWebSearches: 3,
  anthropicModel: "claude-test",
  anthropicWebFetchMaxContentTokens: 12_000,
  internetAccess: "search" as const,
  requestTimeoutMs: 1_000,
};

const request: MarketResolutionRequest = {
  metadata: {
    question: "Did it happen?",
    resolutionCriteria: "Resolve from example.com.",
    resolutionUrl: "https://example.com/",
  },
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockAnthropic(body: unknown) {
  globalThis.fetch = (() =>
    Promise.resolve({
      json: () => Promise.resolve(body),
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;
}

describe("resolveWithAnthropic", () => {
  it("throws without an API key", async () => {
    await expect(
      resolveWithAnthropic({
        config: { ...config, anthropicApiKey: undefined },
        nowMs: 0,
        request,
      }),
    ).rejects.toThrow("ANTHROPIC_API_KEY");
  });

  it("parses the outcome and keeps only tool-result-backed sources", async () => {
    mockAnthropic({
      content: [
        {
          content: [
            {
              title: "Report",
              type: "web_search_result",
              url: "https://example.com/a",
            },
          ],
          type: "web_search_tool_result",
        },
        {
          text: JSON.stringify({
            confidence: 0.92,
            hardFlags: [],
            outcome: "yes",
            reasons: ["Confirmed by the official report."],
            sourceChecks: [
              {
                domain: "example.com",
                notes: "",
                relevant: true,
                sourceTier: "primary",
                url: "https://example.com/a",
              },
              {
                domain: "invented.com",
                notes: "",
                relevant: true,
                sourceTier: "primary",
                url: "https://invented.com/x",
              },
            ],
          }),
          type: "text",
        },
      ],
      model: "claude-test-1",
    });

    const finding = await resolveWithAnthropic({
      config,
      nowMs: 1_780_000_000_000,
      request,
    });

    expect(finding.outcome).toBe("yes");
    expect(finding.confidence).toBe(0.92);
    expect(finding.modelId).toBe("claude-test-1");
    expect(finding.evidence.length).toBeGreaterThan(0);
    // The invented source is dropped; only the tool-result-backed one survives.
    expect(finding.sourceChecks.map((check) => check.domain)).toEqual([
      "example.com",
    ]);
  });
});

describe("anthropicProvider.validateConfig", () => {
  it("errors when the API key is missing", () => {
    const result = anthropicProvider.validateConfig({
      ...aiResolutionConfig,
      anthropicApiKey: undefined,
    });

    expect(result.errors).toContain(
      "ANTHROPIC_API_KEY is required for Anthropic resolution.",
    );
  });
});
