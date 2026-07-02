import { afterEach, describe, expect, it, vi } from "vitest";

import { createInitialMarketDraft } from "@/domain/market-creation/create-market";

import { submitMarketForReview } from "./create-market-service";

describe("submitMarketForReview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits a serialized market preview for review", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        {
          aiReview: {
            source: "local",
            status: "eligible",
          },
          reviewId: "review-test-123",
          status: "queued",
          submittedAt: "2026-06-22T12:00:00.000Z",
        },
        202
      )
    );
    vi.stubGlobal("fetch", fetcher);

    const result = await submitMarketForReview(validDraft());
    const [input, init] = firstFetchCall(fetcher);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const protocolParams = body.protocolParams as Record<string, unknown>;
    const metadata = body.metadata as Record<string, unknown>;

    expect(input).toBe("/api/market-review/submissions");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "content-type": "application/json" });
    expect(metadata.question).toBe("Will the review queue accept this market?");
    expect(protocolParams.metadataURI).toContain("data:application/json");
    expect(protocolParams.graduationDeadline).toMatch(/^\d+$/);
    expect(protocolParams.openingProbabilityWad).toBe("500000000000000000");
    expect(body.metadataHash).toBe(protocolParams.metadataHash);
    expect(result.reviewId).toBe("review-test-123");
    expect(result.reviewStatus).toBe("queued");
    expect(result.aiReview).toEqual({
      source: "local",
      status: "eligible",
    });
  });

  it("surfaces review submission errors", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: "Reviewer queue is unavailable." }, 503)
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(submitMarketForReview(validDraft())).rejects.toThrow(
      "Reviewer queue is unavailable."
    );
  });
});

function validDraft() {
  return {
    ...createInitialMarketDraft(new Date("2030-07-01T12:00:00.000Z")),
    question: "Will the review queue accept this market?",
    resolutionCriteria: "Resolves YES if the review submission endpoint accepts it.",
  };
}

function firstFetchCall(fetcher: ReturnType<typeof vi.fn>) {
  const call = fetcher.mock.calls[0] as Parameters<typeof fetch> | undefined;

  if (!call) {
    throw new Error("Expected fetch to be called.");
  }

  return call;
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}
