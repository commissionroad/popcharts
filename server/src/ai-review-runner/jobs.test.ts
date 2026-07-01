import { describe, expect, it } from "bun:test";

import type { MarketStatus } from "src/api/models/markets";
import type { ReviewResult } from "src/ai-review/types";
import {
  buildMarketReviewRequest,
  calculateRetryDelayMs,
  compactError,
  marketStatusForReviewVerdict,
  type ClaimedReviewJob,
} from "./jobs";

const baseJob = {
  attemptCount: 0,
  chainId: 5042002,
  completedAt: null,
  createdAt: new Date("2026-06-23T12:00:00.000Z"),
  id: 12,
  lastError: null,
  leaseUntil: null,
  lockedBy: null,
  marketId: 77n,
  maxAttempts: 5,
  metadataHash:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  priority: 0,
  requestedModel: null,
  requestedProvider: null,
  reviewId: null,
  runAfter: new Date("2026-06-23T12:00:00.000Z"),
  status: "running" as const,
  trigger: "automatic" as const,
  updatedAt: new Date("2026-06-23T12:00:00.000Z"),
};

const baseMarket = {
  bypassAiResolution: false,
  chainId: 5042002,
  collateral: "0x0000000000000000000000000000000000000002",
  contractId: 1,
  createdAt: new Date("2026-06-23T12:00:00.000Z"),
  createdBlockNumber: 100n,
  createdBlockTimestamp: new Date("2026-06-23T12:00:00.000Z"),
  createdLogIndex: 0,
  createdTransactionHash:
    "0x2222222222222222222222222222222222222222222222222222222222222222",
  creator: "0x00000000000000000000000000000000000000aa",
  graduationThreshold: 1000n,
  graduationTime: new Date("2026-07-01T00:00:00.000Z"),
  id: 9,
  liquidityParameter: 100n,
  marketId: 77n,
  metadataHash:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  noShares: 0n,
  openingProbabilityWad: 500_000_000_000_000_000n,
  receiptCount: 0n,
  resolutionTime: new Date("2026-08-01T00:00:00.000Z"),
  status: "under_review" as const,
  totalEscrowed: 0n,
  updatedAt: new Date("2026-06-23T12:00:00.000Z"),
  yesShares: 0n,
};

const baseMetadata = {
  category: "Science",
  chainId: 5042002,
  createdAt: new Date("2026-06-23T12:00:00.000Z"),
  description: "Resolve using official public reports.",
  id: 4,
  metadataCreatedAt: "2026-06-23T11:59:00.000Z",
  metadataHash:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  question: "Will NASA announce a new Artemis launch date in 2026?",
  resolutionCriteria:
    "YES if NASA publishes an official new launch date before 2027.",
  resolutionUrl: "https://www.nasa.gov/",
  updatedAt: new Date("2026-06-23T12:00:00.000Z"),
};

describe("buildMarketReviewRequest", () => {
  it("builds the AI Review request from persisted market and metadata rows", () => {
    const request = buildMarketReviewRequest({
      job: baseJob,
      market: baseMarket,
      metadata: baseMetadata,
    });

    expect(request).toEqual({
      context: {
        chainId: 5042002,
        creator: "0x00000000000000000000000000000000000000aa",
        marketId: "77",
      },
      metadata: {
        category: "Science",
        createdAt: "2026-06-23T11:59:00.000Z",
        description: "Resolve using official public reports.",
        metadataHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        question: "Will NASA announce a new Artemis launch date in 2026?",
        resolutionCriteria:
          "YES if NASA publishes an official new launch date before 2027.",
        resolutionUrl: "https://www.nasa.gov/",
      },
    });
  });

  it("passes only explicit provider and model overrides from the job", () => {
    const request = buildMarketReviewRequest({
      job: {
        ...baseJob,
        requestedModel: "local-model",
        requestedProvider: "ollama",
      },
      market: baseMarket,
      metadata: {
        ...baseMetadata,
        resolutionUrl: null,
      },
    });

    expect(request.options).toEqual({
      model: "local-model",
      provider: "ollama",
    });
    expect(request.metadata).not.toHaveProperty("resolutionUrl");
  });
});

describe("marketStatusForReviewVerdict", () => {
  for (const [verdict, status] of [
    ["approve", "bootstrap"],
    ["reject", "rejected"],
    ["manual_review", null],
  ] as Array<[ReviewResult["verdict"], MarketStatus | null]>) {
    it(`maps ${verdict} review verdicts to guarded market transition ${status}`, () => {
      expect(marketStatusForReviewVerdict(verdict)).toBe(status);
    });
  }
});

describe("retry helpers", () => {
  it("backs off exponentially from the current attempt count", () => {
    expect(calculateRetryDelayMs({ attemptCount: 1, baseMs: 1_000 })).toBe(
      1_000,
    );
    expect(calculateRetryDelayMs({ attemptCount: 2, baseMs: 1_000 })).toBe(
      2_000,
    );
    expect(calculateRetryDelayMs({ attemptCount: 3, baseMs: 1_000 })).toBe(
      4_000,
    );
  });

  it("compacts errors for operator-friendly job state", () => {
    expect(compactError(new Error("first\nsecond\tthird"))).toBe(
      "first second third",
    );
  });
});
