import { describe, expect, it } from "bun:test";

import type { ReviewResult } from "src/ai-review/types";
import { AiReviewServiceError, reviewMarketWithService } from "./client";

const request = {
  metadata: {
    question: "Will a public event happen?",
    resolutionCriteria: "Resolve from official public records.",
  },
};

const result: ReviewResult = {
  evidence: [],
  hardFlags: [],
  promptVersion: "ai-review-v1",
  provider: "heuristic",
  reasons: ["Looks publicly knowable."],
  scores: {
    contentSafety: 0,
    corroboration: 3,
    disputeRisk: 2,
    objectivity: 1,
    promptInjectionRisk: 0,
    publicKnowability: 1,
    sourceQuality: 2,
  },
  sourceChecks: [],
  verdict: "approve",
};

describe("reviewMarketWithService", () => {
  it("posts market review requests to the configured service", async () => {
    const calls: Array<{ body: unknown; url: string }> = [];
    const response = await reviewMarketWithService({
      config: {
        requestTimeoutMs: 1_000,
        serviceUrl: "http://ai-review.internal",
      },
      fetchImpl: async (input, init) => {
        calls.push({
          body: JSON.parse(init?.body as string),
          url: input.toString(),
        });
        return Response.json(result);
      },
      request,
    });

    expect(response).toEqual(result);
    expect(calls).toEqual([
      {
        body: request,
        url: "http://ai-review.internal/reviews/market",
      },
    ]);
  });

  it("throws a compact service error for non-2xx responses", async () => {
    await expect(
      reviewMarketWithService({
        config: {
          requestTimeoutMs: 1_000,
          serviceUrl: "http://ai-review.internal",
        },
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "down" }), { status: 503 }),
        request,
      }),
    ).rejects.toEqual(
      new AiReviewServiceError("AI Review service returned HTTP 503.", 503),
    );
  });
});
