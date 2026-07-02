import { describe, expect, it } from "bun:test";

import {
  parseSinceTimestamp,
  serializeMarketAiReviewRow,
  serializeMarketRow,
  type MarketAiReviewRow,
  type MarketRow,
} from "./markets";

const market = {
  bypassAiResolution: false,
  chainId: 5042002,
  collateral: "0x0000000000000000000000000000000000000002",
  contractId: 1,
  createdAt: new Date("2026-06-23T12:00:00.000Z"),
  createdBlockNumber: 123n,
  createdBlockTimestamp: new Date("2026-06-23T11:59:00.000Z"),
  createdLogIndex: 4,
  createdTransactionHash:
    "0x2222222222222222222222222222222222222222222222222222222222222222",
  creator: "0x00000000000000000000000000000000000000aa",
  graduationThreshold: 2_500n * 10n ** 18n,
  graduationTime: new Date("2026-07-01T00:00:00.000Z"),
  id: 7,
  liquidityParameter: 5_000n * 10n ** 18n,
  marketId: 42n,
  metadataHash:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  metadataUri: "ipfs://popcharts/test-market",
  noShares: 0n,
  openingProbabilityWad: 500_000_000_000_000_000n,
  receiptCount: 0n,
  resolutionTime: new Date("2026-08-01T00:00:00.000Z"),
  status: "under_review",
  totalEscrowed: 0n,
  updatedAt: new Date("2026-06-23T12:01:00.000Z"),
  yesShares: 0n,
} satisfies MarketRow;

const review = {
  chainId: 5042002,
  createdAt: new Date("2026-06-23T12:03:00.000Z"),
  evidence: [
    {
      domain: "www.nasa.gov",
      kind: "search_result",
      sourceTier: "primary",
      summary: "NASA page found by review.",
      title: "NASA Artemis News",
      url: "https://www.nasa.gov/news/",
    },
  ],
  hardFlags: [],
  id: 11,
  marketId: 42n,
  metadataHash:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  modelId: "claude-sonnet-4-6",
  promptVersion: "market-ai-review-v1",
  provider: "anthropic",
  reasons: ["NASA is a primary public source."],
  reviewedAt: new Date("2026-06-23T12:02:00.000Z"),
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
      notes: "Official NASA source.",
      relevant: true,
      sourceTier: "primary",
      url: "https://www.nasa.gov/news/",
    },
  ],
  verdict: "approve",
} satisfies MarketAiReviewRow;

describe("parseSinceTimestamp", () => {
  it("accepts ISO timestamps", () => {
    expect(parseSinceTimestamp("2026-06-13T12:00:00.000Z")?.toISOString()).toBe(
      "2026-06-13T12:00:00.000Z",
    );
  });

  it("returns null for missing or invalid timestamps", () => {
    expect(parseSinceTimestamp()).toBeNull();
    expect(parseSinceTimestamp("not-a-date")).toBeNull();
  });
});

describe("market serializers", () => {
  it("serializes a persisted AI review attempt for market reads", () => {
    expect(serializeMarketAiReviewRow(review)).toEqual({
      createdAt: "2026-06-23T12:03:00.000Z",
      evidence: review.evidence,
      hardFlags: [],
      id: 11,
      metadataHash: review.metadataHash,
      modelId: "claude-sonnet-4-6",
      promptVersion: "market-ai-review-v1",
      provider: "anthropic",
      reasons: ["NASA is a primary public source."],
      reviewedAt: "2026-06-23T12:02:00.000Z",
      scores: review.scores,
      sourceChecks: review.sourceChecks,
      verdict: "approve",
    });
  });

  it("includes the latest AI review on serialized market rows", () => {
    const serialized = serializeMarketRow(market, null, 0n, review);

    expect(serialized.aiReview?.id).toBe(11);
    expect(serialized.aiReview?.verdict).toBe("approve");
    expect(serialized.marketId).toBe("42");
    expect(serialized.metadataUri).toBe("ipfs://popcharts/test-market");
    expect(serialized.status).toBe("under_review");
  });

  it("omits AI review when no review has been persisted", () => {
    const serialized = serializeMarketRow(market, null, 0n);

    expect(serialized.aiReview).toBeUndefined();
  });
});
