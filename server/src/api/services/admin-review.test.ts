import { describe, expect, it } from "bun:test";

import type { schema } from "src/db/client";
import {
  requestManualMarketReview,
  serializeMarketAiReviewJobRow,
  type EnqueueManualReviewJobInput,
  type ManualMarketReviewDependencies,
} from "./admin-review";

describe("requestManualMarketReview", () => {
  it("is disabled unless the admin review endpoint is explicitly enabled", async () => {
    const result = await requestManualMarketReview(
      { chainId: 5042002, marketId: "7" },
      createDependencies({ adminReviewEnabled: false }),
    );

    expect(result).toEqual({
      kind: "admin_disabled",
      message: "Admin review enqueue is disabled.",
    });
  });

  it("returns an existing active job instead of enqueueing duplicate work", async () => {
    let enqueueTouched = false;
    const activeJob = createJobRow({ id: 99, status: "running" });
    const result = await requestManualMarketReview(
      { chainId: 5042002, marketId: "7" },
      createDependencies({
        activeJob,
        enqueueJob: async () => {
          enqueueTouched = true;
          throw new Error("unexpected enqueue");
        },
      }),
    );

    expect(enqueueTouched).toBe(false);
    expect(result).toEqual({
      job: serializeMarketAiReviewJobRow(activeJob),
      kind: "existing_active_job",
      message:
        "An active AI review job already exists for this market metadata hash.",
    });
  });

  it("conflicts when a completed review already exists and force is false", async () => {
    const result = await requestManualMarketReview(
      { chainId: 5042002, marketId: "7" },
      createDependencies({
        latestReview: createReviewRow({ id: 44 }),
      }),
    );

    expect(result).toMatchObject({
      aiReview: {
        id: 44,
        verdict: "approve",
      },
      kind: "already_reviewed",
      message:
        "An AI review already exists for this market metadata hash. Set force=true to queue a re-review.",
    });
  });

  it("force-enqueues a manual job even when a completed review exists", async () => {
    let enqueueInput: EnqueueManualReviewJobInput | null = null;
    const job = createJobRow({
      requestedModel: "local-model",
      requestedProvider: "ollama",
    });
    const result = await requestManualMarketReview(
      {
        body: {
          force: true,
          model: "local-model",
          provider: "ollama",
          reason: "operator retry",
        },
        chainId: 5042002,
        marketId: "7",
      },
      createDependencies({
        enqueueJob: async (input) => {
          enqueueInput = input;
          return job;
        },
        latestReview: createReviewRow(),
      }),
    );

    expect(enqueueInput).toMatchObject({
      chainId: 5042002,
      marketId: 7n,
      metadataHash:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      model: "local-model",
      provider: "ollama",
    });
    expect(result).toEqual({
      job: serializeMarketAiReviewJobRow(job),
      kind: "enqueued",
    });
  });

  it("rejects markets that are not under review", async () => {
    const result = await requestManualMarketReview(
      { chainId: 5042002, marketId: "7" },
      createDependencies({
        market: createMarketRow({ status: "bootstrap" }),
      }),
    );

    expect(result).toEqual({
      kind: "ineligible",
      marketStatus: "bootstrap",
      message:
        "Market is bootstrap; only under_review markets can be queued for AI review.",
      reason: "wrong_status",
    });
  });

  it("requires persisted metadata for the current market metadata hash", async () => {
    const result = await requestManualMarketReview(
      { chainId: 5042002, marketId: "7" },
      createDependencies({ metadata: null }),
    );

    expect(result).toEqual({
      kind: "ineligible",
      message:
        "Market metadata is missing for the current metadata hash; AI review cannot be queued.",
      reason: "missing_metadata",
    });
  });

  it("rejects invalid market IDs before selecting rows", async () => {
    let selected = false;
    const result = await requestManualMarketReview(
      { chainId: 5042002, marketId: "not-a-bigint" },
      {
        ...createDependencies(),
        selectMarket: async () => {
          selected = true;
          return null;
        },
      },
    );

    expect(selected).toBe(false);
    expect(result).toEqual({
      kind: "invalid_market_id",
      message: "Invalid market id.",
    });
  });
});

function createDependencies({
  activeJob = null,
  adminReviewEnabled = true,
  enqueueJob = async () => createJobRow(),
  latestReview = null,
  market = createMarketRow(),
  metadata = createMetadataRow(),
}: {
  activeJob?: JobRow | null;
  adminReviewEnabled?: boolean;
  enqueueJob?: ManualMarketReviewDependencies["enqueueJob"];
  latestReview?: ReviewRow | null;
  market?: MarketRow;
  metadata?: MetadataRow | null;
} = {}): ManualMarketReviewDependencies {
  return {
    adminReviewEnabled: () => adminReviewEnabled,
    enqueueJob,
    selectActiveJob: async () => activeJob,
    selectLatestReview: async () => latestReview,
    selectMarket: async ({ chainId, marketId }) =>
      chainId === market.chainId && marketId === market.marketId
        ? { market, metadata }
        : null,
  };
}

type MarketRow = typeof schema.markets.$inferSelect;
type MetadataRow = typeof schema.marketMetadata.$inferSelect;
type JobRow = typeof schema.marketAiReviewJobs.$inferSelect;
type ReviewRow = typeof schema.marketAiReviews.$inferSelect;

function createMarketRow(overrides: Partial<MarketRow> = {}): MarketRow {
  return {
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
    marketId: 7n,
    metadataHash:
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    noShares: 0n,
    openingProbabilityWad: 500_000_000_000_000_000n,
    receiptCount: 0n,
    resolutionTime: new Date("2026-08-01T00:00:00.000Z"),
    status: "under_review",
    totalEscrowed: 0n,
    updatedAt: new Date("2026-06-23T12:00:00.000Z"),
    yesShares: 0n,
    ...overrides,
  };
}

function createMetadataRow(overrides: Partial<MetadataRow> = {}): MetadataRow {
  return {
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
    resolutionSources: ["Official NASA announcements"],
    resolutionUrl: "https://www.nasa.gov/",
    updatedAt: new Date("2026-06-23T12:00:00.000Z"),
    ...overrides,
  };
}

function createJobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    attemptCount: 0,
    chainId: 5042002,
    completedAt: null,
    createdAt: new Date("2026-06-23T12:00:00.000Z"),
    id: 12,
    lastError: null,
    leaseUntil: null,
    lockedBy: null,
    marketId: 7n,
    maxAttempts: 5,
    metadataHash:
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    priority: 100,
    requestedModel: null,
    requestedProvider: null,
    reviewId: null,
    runAfter: new Date("2026-06-23T12:00:00.000Z"),
    status: "queued",
    trigger: "manual",
    updatedAt: new Date("2026-06-23T12:00:00.000Z"),
    ...overrides,
  };
}

function createReviewRow(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    chainId: 5042002,
    createdAt: new Date("2026-06-23T12:03:00.000Z"),
    evidence: [],
    hardFlags: [],
    id: 11,
    marketId: 7n,
    metadataHash:
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    modelId: null,
    promptVersion: "market-ai-review-v1",
    provider: "heuristic",
    reasons: ["Looks publicly knowable."],
    reviewedAt: new Date("2026-06-23T12:02:00.000Z"),
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
    ...overrides,
  };
}
