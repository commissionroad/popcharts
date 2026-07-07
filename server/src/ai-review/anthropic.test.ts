import { afterEach, describe, expect, it } from "bun:test";

import type { AiReviewConfig } from "./config";
import { reviewWithAnthropic } from "./anthropic";

const originalFetch = globalThis.fetch;

const baseConfig: Pick<
  AiReviewConfig,
  | "anthropicApiKey"
  | "anthropicBaseUrl"
  | "anthropicMaxOutputTokens"
  | "anthropicMaxWebFetches"
  | "anthropicMaxWebSearches"
  | "anthropicModel"
  | "anthropicWebFetchMaxContentTokens"
  | "internetAccess"
  | "requestTimeoutMs"
> = {
  anthropicApiKey: "test-key",
  anthropicBaseUrl: "https://api.anthropic.test",
  anthropicMaxOutputTokens: 512,
  anthropicMaxWebFetches: 1,
  anthropicMaxWebSearches: 2,
  anthropicModel: "claude-sonnet-4-6",
  anthropicWebFetchMaxContentTokens: 1_000,
  internetAccess: "search",
  requestTimeoutMs: 100,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("reviewWithAnthropic", () => {
  it("uses Claude web search and maps citations into evidence", async () => {
    const bodies: unknown[] = [];
    globalThis.fetch = (async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));

      return new Response(
        JSON.stringify({
          content: [
            {
              content: [
                {
                  page_age: "June 2026",
                  title: "NASA Artemis News",
                  type: "web_search_result",
                  url: "https://www.nasa.gov/news/",
                },
              ],
              type: "web_search_tool_result",
            },
            {
              citations: [
                {
                  cited_text: "NASA announced an updated Artemis launch date.",
                  title: "NASA Artemis News",
                  type: "web_search_result_location",
                  url: "https://www.nasa.gov/news/",
                },
              ],
              text: JSON.stringify({
                hardFlags: [],
                reasons: ["NASA is a primary public source."],
                scores: {
                  contentSafety: 5,
                  corroboration: 2,
                  disputeRisk: 1,
                  objectivity: 5,
                  promptInjectionRisk: 0,
                  publicKnowability: 5,
                  sourceQuality: 5,
                },
                sourceChecks: [
                  {
                    domain: "www.nasa.gov",
                    notes: "Official NASA source cited by Claude web search.",
                    relevant: true,
                    sourceTier: "primary",
                    url: "https://www.nasa.gov/news/",
                  },
                ],
                verdict: "approve",
              }),
              type: "text",
            },
          ],
          model: "claude-sonnet-4-6",
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        },
      );
    }) as typeof fetch;

    const result = await reviewWithAnthropic({
      config: baseConfig,
      request: {
        metadata: {
          question: "Will NASA announce a new Artemis launch date in 2026?",
          resolutionCriteria: "Resolve from a public NASA announcement.",
        },
      },
    });

    expect(result.verdict).toBe("approve");
    expect(result.modelId).toBe("claude-sonnet-4-6");
    expect(result.evidence).toContainEqual({
      domain: "www.nasa.gov",
      kind: "search_result",
      sourceTier: "primary",
      summary: "NASA announced an updated Artemis launch date.",
      title: "NASA Artemis News",
      url: "https://www.nasa.gov/news/",
    });
    expect(result.sourceChecks).toHaveLength(1);
    expect(bodies).toHaveLength(1);
    expect(
      (bodies[0] as { tools?: Array<Record<string, unknown>> }).tools,
    ).toContainEqual({
      max_uses: 2,
      name: "web_search",
      type: "web_search_20250305",
    });
  });
});
