import type {
  ManualAiReviewIneligibleReason,
  ManualAiReviewRequest,
  MarketAiReviewJobResponse,
  MarketAiReviewResponse,
  MarketStatus,
} from "src/api/models/markets";
import { config } from "src/config";
import { and, db, desc, eq, inArray, schema } from "src/db/client";
import { serializeMarketAiReviewRow } from "./markets";

const DEFAULT_MANUAL_JOB_PRIORITY = 100;
const DEFAULT_MANUAL_MAX_ATTEMPTS = 5;

type MarketRow = typeof schema.markets.$inferSelect;
type MarketMetadataRow = typeof schema.marketMetadata.$inferSelect;
type MarketAiReviewRow = typeof schema.marketAiReviews.$inferSelect;
type MarketAiReviewJobRow = typeof schema.marketAiReviewJobs.$inferSelect;

const ACTIVE_JOB_STATUSES: Array<MarketAiReviewJobRow["status"]> = [
  "queued",
  "running",
  "retryable_failed",
];

type ManualReviewMarketRow = {
  market: MarketRow;
  metadata: MarketMetadataRow | null;
};

export type ManualMarketReviewResult =
  | {
      kind: "admin_disabled";
      message: string;
    }
  | {
      kind: "already_reviewed";
      aiReview: MarketAiReviewResponse;
      message: string;
    }
  | {
      kind: "enqueued";
      job: MarketAiReviewJobResponse;
    }
  | {
      kind: "existing_active_job";
      job: MarketAiReviewJobResponse;
      message: string;
    }
  | {
      kind: "ineligible";
      marketStatus?: MarketStatus;
      message: string;
      reason: ManualAiReviewIneligibleReason;
    }
  | {
      kind: "invalid_market_id";
      message: string;
    }
  | {
      kind: "not_found";
      message: string;
    };

export type EnqueueManualReviewJobInput = {
  chainId: number;
  marketId: bigint;
  metadataHash: string;
  model?: string;
  now: Date;
  provider?: ManualAiReviewRequest["provider"];
};

export type ManualMarketReviewDependencies = {
  adminReviewEnabled: () => boolean;
  enqueueJob: (
    input: EnqueueManualReviewJobInput,
  ) => Promise<MarketAiReviewJobRow | null>;
  selectActiveJob: ({
    chainId,
    marketId,
    metadataHash,
  }: {
    chainId: number;
    marketId: bigint;
    metadataHash: string;
  }) => Promise<MarketAiReviewJobRow | null>;
  selectLatestReview: ({
    chainId,
    marketId,
    metadataHash,
  }: {
    chainId: number;
    marketId: bigint;
    metadataHash: string;
  }) => Promise<MarketAiReviewRow | null>;
  selectMarket: ({
    chainId,
    marketId,
  }: {
    chainId: number;
    marketId: bigint;
  }) => Promise<ManualReviewMarketRow | null>;
};

export async function requestManualMarketReview(
  {
    body = {},
    chainId,
    marketId,
  }: {
    body?: ManualAiReviewRequest;
    chainId: number;
    marketId: string;
  },
  dependencies: ManualMarketReviewDependencies = defaultManualReviewDependencies,
): Promise<ManualMarketReviewResult> {
  if (!dependencies.adminReviewEnabled()) {
    return {
      kind: "admin_disabled",
      message: "Admin review enqueue is disabled.",
    };
  }

  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return {
      kind: "invalid_market_id",
      message: "Invalid chain id.",
    };
  }

  let parsedMarketId: bigint;
  try {
    parsedMarketId = BigInt(marketId);
  } catch {
    return {
      kind: "invalid_market_id",
      message: "Invalid market id.",
    };
  }

  const row = await dependencies.selectMarket({
    chainId,
    marketId: parsedMarketId,
  });

  if (!row) {
    return {
      kind: "not_found",
      message: "Market not found.",
    };
  }

  if (row.market.status !== "under_review") {
    return {
      kind: "ineligible",
      marketStatus: row.market.status,
      message: `Market is ${row.market.status}; only under_review markets can be queued for AI review.`,
      reason: "wrong_status",
    };
  }

  if (!row.metadata) {
    return {
      kind: "ineligible",
      message:
        "Market metadata is missing for the current metadata hash; AI review cannot be queued.",
      reason: "missing_metadata",
    };
  }

  const activeJob = await dependencies.selectActiveJob({
    chainId,
    marketId: parsedMarketId,
    metadataHash: row.market.metadataHash,
  });

  if (activeJob) {
    return {
      kind: "existing_active_job",
      job: serializeMarketAiReviewJobRow(activeJob),
      message:
        "An active AI review job already exists for this market metadata hash.",
    };
  }

  if (!body.force) {
    const existingReview = await dependencies.selectLatestReview({
      chainId,
      marketId: parsedMarketId,
      metadataHash: row.market.metadataHash,
    });

    if (existingReview) {
      return {
        aiReview: serializeMarketAiReviewRow(existingReview),
        kind: "already_reviewed",
        message:
          "An AI review already exists for this market metadata hash. Set force=true to queue a re-review.",
      };
    }
  }

  const now = new Date();
  const job = await dependencies.enqueueJob({
    chainId,
    marketId: parsedMarketId,
    metadataHash: row.market.metadataHash,
    ...(body.model ? { model: body.model } : {}),
    now,
    ...(body.provider ? { provider: body.provider } : {}),
  });

  if (job) {
    return {
      job: serializeMarketAiReviewJobRow(job),
      kind: "enqueued",
    };
  }

  const racedJob = await dependencies.selectActiveJob({
    chainId,
    marketId: parsedMarketId,
    metadataHash: row.market.metadataHash,
  });

  if (racedJob) {
    return {
      kind: "existing_active_job",
      job: serializeMarketAiReviewJobRow(racedJob),
      message:
        "An active AI review job already exists for this market metadata hash.",
    };
  }

  throw new Error("Failed to enqueue manual AI review job.");
}

export function serializeMarketAiReviewJobRow(
  job: MarketAiReviewJobRow,
): MarketAiReviewJobResponse {
  return {
    attemptCount: job.attemptCount,
    chainId: job.chainId,
    ...(job.completedAt ? { completedAt: job.completedAt.toISOString() } : {}),
    createdAt: job.createdAt.toISOString(),
    id: job.id,
    ...(job.lastError ? { lastError: job.lastError } : {}),
    ...(job.leaseUntil ? { leaseUntil: job.leaseUntil.toISOString() } : {}),
    ...(job.lockedBy ? { lockedBy: job.lockedBy } : {}),
    marketId: job.marketId.toString(),
    maxAttempts: job.maxAttempts,
    metadataHash: job.metadataHash,
    priority: job.priority,
    ...(job.requestedModel ? { requestedModel: job.requestedModel } : {}),
    ...(job.requestedProvider
      ? { requestedProvider: job.requestedProvider }
      : {}),
    ...(job.reviewId ? { reviewId: job.reviewId } : {}),
    runAfter: job.runAfter.toISOString(),
    status: job.status,
    trigger: job.trigger,
    updatedAt: job.updatedAt.toISOString(),
  };
}

const defaultManualReviewDependencies: ManualMarketReviewDependencies = {
  adminReviewEnabled: () => config.adminReviewEnabled,
  enqueueJob: enqueueManualReviewJob,
  selectActiveJob: selectActiveReviewJob,
  selectLatestReview: selectLatestAiReview,
  selectMarket: selectMarketForManualReview,
};

async function selectMarketForManualReview({
  chainId,
  marketId,
}: {
  chainId: number;
  marketId: bigint;
}): Promise<ManualReviewMarketRow | null> {
  const rows = await db
    .select({
      market: schema.markets,
      metadata: schema.marketMetadata,
    })
    .from(schema.markets)
    .leftJoin(
      schema.marketMetadata,
      and(
        eq(schema.marketMetadata.chainId, schema.markets.chainId),
        eq(schema.marketMetadata.metadataHash, schema.markets.metadataHash),
      ),
    )
    .where(
      and(
        eq(schema.markets.chainId, chainId),
        eq(schema.markets.marketId, marketId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function selectActiveReviewJob({
  chainId,
  marketId,
  metadataHash,
}: {
  chainId: number;
  marketId: bigint;
  metadataHash: string;
}) {
  const rows = await db
    .select()
    .from(schema.marketAiReviewJobs)
    .where(
      and(
        eq(schema.marketAiReviewJobs.chainId, chainId),
        eq(schema.marketAiReviewJobs.marketId, marketId),
        eq(schema.marketAiReviewJobs.metadataHash, metadataHash),
        inArray(schema.marketAiReviewJobs.status, ACTIVE_JOB_STATUSES),
      ),
    )
    .orderBy(
      desc(schema.marketAiReviewJobs.priority),
      desc(schema.marketAiReviewJobs.updatedAt),
      desc(schema.marketAiReviewJobs.id),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function selectLatestAiReview({
  chainId,
  marketId,
  metadataHash,
}: {
  chainId: number;
  marketId: bigint;
  metadataHash: string;
}) {
  const rows = await db
    .select()
    .from(schema.marketAiReviews)
    .where(
      and(
        eq(schema.marketAiReviews.chainId, chainId),
        eq(schema.marketAiReviews.marketId, marketId),
        eq(schema.marketAiReviews.metadataHash, metadataHash),
      ),
    )
    .orderBy(
      desc(schema.marketAiReviews.reviewedAt),
      desc(schema.marketAiReviews.id),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function enqueueManualReviewJob({
  chainId,
  marketId,
  metadataHash,
  model,
  now,
  provider,
}: EnqueueManualReviewJobInput) {
  const [job] = await db
    .insert(schema.marketAiReviewJobs)
    .values({
      chainId,
      marketId,
      maxAttempts: DEFAULT_MANUAL_MAX_ATTEMPTS,
      metadataHash,
      priority: DEFAULT_MANUAL_JOB_PRIORITY,
      requestedModel: model ?? null,
      requestedProvider: provider ?? null,
      runAfter: now,
      trigger: "manual",
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();

  return job ?? null;
}
