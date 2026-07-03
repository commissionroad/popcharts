import type { MarketStatus } from "src/api/models/markets";
import type { MarketReviewRequest, ReviewResult } from "src/ai-review/types";
import {
  and,
  asc,
  db,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  or,
  schema,
  sql,
} from "src/db/client";
import { reviewMarketWithService } from "./client";
import type { AiReviewRunnerConfig } from "./config";

const MAX_RETRY_DELAY_MS = 30 * 60 * 1000;
const MAX_ERROR_LENGTH = 800;

/** Drizzle select shape of a market_ai_review_jobs queue row. */
export type MarketAiReviewJobRow =
  typeof schema.marketAiReviewJobs.$inferSelect;
/** Drizzle select shape of a market_ai_reviews audit row. */
export type MarketAiReviewRow = typeof schema.marketAiReviews.$inferSelect;
/** Drizzle select shape of a markets row. */
export type MarketRow = typeof schema.markets.$inferSelect;
/** Drizzle select shape of a market_metadata row. */
export type MarketMetadataRow = typeof schema.marketMetadata.$inferSelect;

/**
 * A leased job joined with the market and metadata rows it will review —
 * everything processReviewJob needs without further queries.
 */
export type ClaimedReviewJob = {
  job: MarketAiReviewJobRow;
  market: MarketRow;
  metadata: MarketMetadataRow;
};

/**
 * Terminal state of one processing attempt, as reported to the runner loop:
 * cancelled (market moved on), succeeded (review persisted, market possibly
 * transitioned), or a retryable/terminal failure.
 */
export type ReviewJobOutcome =
  | {
      job: MarketAiReviewJobRow;
      status: "cancelled";
    }
  | {
      job: MarketAiReviewJobRow;
      review: MarketAiReviewRow;
      status: "succeeded";
      targetMarketStatus: MarketStatus | null;
      transitionedMarket: boolean;
    }
  | {
      job: MarketAiReviewJobRow;
      status: "retryable_failed" | "terminal_failed";
    };

/**
 * Finds under-review markets that have metadata, no active job, and no review
 * for the exact current metadata hash, then turns them into queue rows.
 */
export async function enqueueEligibleMarketReviewJobs({
  limit,
  maxAttempts,
  now = new Date(),
}: {
  limit: number;
  maxAttempts: number;
  now?: Date;
}): Promise<MarketAiReviewJobRow[]> {
  const candidates = await db
    .select({
      market: schema.markets,
    })
    .from(schema.markets)
    .innerJoin(
      schema.marketMetadata,
      and(
        eq(schema.marketMetadata.chainId, schema.markets.chainId),
        eq(schema.marketMetadata.metadataHash, schema.markets.metadataHash),
      ),
    )
    .where(
      and(
        eq(schema.markets.status, "under_review"),
        noActiveReviewJobForCurrentMarket(),
        noAiReviewForCurrentMarket(),
      ),
    )
    .orderBy(asc(schema.markets.createdAt), asc(schema.markets.id))
    .limit(limit);

  if (candidates.length === 0) {
    return [];
  }

  const values = candidates.map(({ market }) => ({
    attemptCount: 0,
    chainId: market.chainId,
    maxAttempts,
    marketId: market.marketId,
    metadataHash: market.metadataHash,
    runAfter: now,
    trigger: "automatic" as const,
    updatedAt: now,
  }));

  return await db
    .insert(schema.marketAiReviewJobs)
    .values(values)
    // The partial unique active-job index is the final race guard if two runner
    // processes discover the same market at the same time.
    .onConflictDoNothing()
    .returning();
}

/**
 * Leases due jobs using row locks. A claimed job is marked running, stamped
 * with locked_by/lease_until, and has its attempt count incremented in the same
 * transaction that selected it.
 */
export async function claimReviewJobs({
  config,
  now = new Date(),
}: {
  config: Pick<AiReviewRunnerConfig, "batchSize" | "leaseMs" | "runnerId">;
  now?: Date;
}): Promise<ClaimedReviewJob[]> {
  return await db.transaction(async (tx) => {
    const claimableJobs = await tx
      .select({
        id: schema.marketAiReviewJobs.id,
      })
      .from(schema.marketAiReviewJobs)
      .where(claimableReviewJobCondition(now))
      .orderBy(
        desc(schema.marketAiReviewJobs.priority),
        asc(schema.marketAiReviewJobs.runAfter),
        asc(schema.marketAiReviewJobs.id),
      )
      .limit(config.batchSize)
      // SKIP LOCKED lets other runner transactions keep moving instead of
      // waiting behind rows already selected by a different runner.
      .for("update", { skipLocked: true });

    const jobIds = claimableJobs.map(({ id }) => id);
    if (jobIds.length === 0) {
      return [];
    }

    const leaseUntil = new Date(now.getTime() + config.leaseMs);
    await tx
      .update(schema.marketAiReviewJobs)
      .set({
        attemptCount: sql`${schema.marketAiReviewJobs.attemptCount} + 1`,
        leaseUntil,
        lockedBy: config.runnerId,
        status: "running",
        updatedAt: now,
      })
      .where(inArray(schema.marketAiReviewJobs.id, jobIds));

    const claimed = await tx
      .select({
        job: schema.marketAiReviewJobs,
        market: schema.markets,
        metadata: schema.marketMetadata,
      })
      .from(schema.marketAiReviewJobs)
      .innerJoin(
        schema.markets,
        and(
          eq(schema.markets.chainId, schema.marketAiReviewJobs.chainId),
          eq(schema.markets.marketId, schema.marketAiReviewJobs.marketId),
          eq(
            schema.markets.metadataHash,
            schema.marketAiReviewJobs.metadataHash,
          ),
        ),
      )
      .innerJoin(
        schema.marketMetadata,
        and(
          eq(schema.marketMetadata.chainId, schema.marketAiReviewJobs.chainId),
          eq(
            schema.marketMetadata.metadataHash,
            schema.marketAiReviewJobs.metadataHash,
          ),
        ),
      )
      .where(inArray(schema.marketAiReviewJobs.id, jobIds));

    const order = new Map(jobIds.map((id, index) => [id, index]));
    // Postgres does not promise returned join rows will match the selected ID
    // order, so restore the claim order before handing work to the runner loop.
    return claimed.sort(
      (left, right) =>
        (order.get(left.job.id) ?? 0) - (order.get(right.job.id) ?? 0),
    );
  });
}

/**
 * Runs one claimed job end to end: cancels cleanly if the market left
 * under_review while queued, otherwise calls the AI Review service, persists
 * the review atomically with the job completion, and on error schedules a
 * backed-off retry until maxAttempts is exhausted.
 */
export async function processReviewJob({
  claimed,
  config,
  now = new Date(),
}: {
  claimed: ClaimedReviewJob;
  config: AiReviewRunnerConfig;
  now?: Date;
}): Promise<ReviewJobOutcome> {
  // Jobs can sit in the queue while another authority moves the market. In that
  // case there is nothing left for AI review to decide, so close the job cleanly.
  if (claimed.market.status !== "under_review") {
    const job = await cancelReviewJob({
      job: claimed.job,
      now,
      reason: `Market status is ${claimed.market.status}.`,
    });
    return { job, status: "cancelled" };
  }

  try {
    const result = await reviewMarketWithService({
      config,
      request: buildMarketReviewRequest(claimed),
    });

    const persisted = await persistReviewJobResult({
      job: claimed.job,
      result,
      reviewedAt: now,
    });

    return {
      job: persisted.job,
      review: persisted.review,
      status: "succeeded",
      targetMarketStatus: persisted.targetMarketStatus,
      transitionedMarket: persisted.transitionedMarket,
    };
  } catch (error) {
    const job = await markReviewJobFailure({
      error,
      job: claimed.job,
      now,
      retryBaseMs: config.backoffMs,
    });

    return {
      job,
      status: job.status as "retryable_failed" | "terminal_failed",
    };
  }
}

/**
 * Builds the stateless AI Review service request from persisted rows. Job-level
 * provider/model overrides are allowed, but market text is never allowed to
 * choose provider, model, web mode, retry policy, or transition behavior.
 */
export function buildMarketReviewRequest({
  job,
  market,
  metadata,
}: ClaimedReviewJob): MarketReviewRequest {
  const options: MarketReviewRequest["options"] = {};
  if (job.requestedProvider) {
    options.provider = job.requestedProvider;
  }
  if (job.requestedModel) {
    options.model = job.requestedModel;
  }

  return {
    context: {
      chainId: market.chainId,
      creator: market.creator,
      marketId: market.marketId.toString(),
    },
    metadata: {
      category: metadata.category,
      createdAt: metadata.metadataCreatedAt,
      description: metadata.description,
      metadataHash: metadata.metadataHash,
      question: metadata.question,
      resolutionCriteria: metadata.resolutionCriteria,
      ...(metadata.resolutionSources.length > 0
        ? { resolutionSources: metadata.resolutionSources }
        : {}),
      ...(metadata.resolutionUrl
        ? { resolutionUrl: metadata.resolutionUrl }
        : {}),
    },
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}

/**
 * Maps a review verdict to the market status it should trigger: approve moves
 * the market into bootstrap, reject marks it rejected, and manual_review
 * returns null because a human — not the runner — must decide.
 */
export function marketStatusForReviewVerdict(
  verdict: ReviewResult["verdict"],
): MarketStatus | null {
  if (verdict === "approve") {
    return "bootstrap";
  }

  if (verdict === "reject") {
    return "rejected";
  }

  return null;
}

/**
 * Exponential retry delay, capped so an unhealthy service does not create
 * unbounded retry gaps.
 */
export function calculateRetryDelayMs({
  attemptCount,
  baseMs,
}: {
  attemptCount: number;
  baseMs: number;
}) {
  const exponent = Math.max(attemptCount - 1, 0);
  return Math.min(baseMs * 2 ** exponent, MAX_RETRY_DELAY_MS);
}

/**
 * Flattens any thrown value into a single-line message capped at 800
 * characters, so the job row's last_error column stays bounded and readable.
 */
export function compactError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error || "Unknown error");
  return message.replace(/\s+/g, " ").slice(0, MAX_ERROR_LENGTH);
}

async function persistReviewJobResult({
  job,
  result,
  reviewedAt,
}: {
  job: MarketAiReviewJobRow;
  result: ReviewResult;
  reviewedAt: Date;
}) {
  return await db.transaction(async (tx) => {
    // The review row is append-only audit evidence. The job row is mutable queue
    // state and simply points at the review that completed it.
    const [review] = await tx
      .insert(schema.marketAiReviews)
      .values({
        chainId: job.chainId,
        evidence: result.evidence,
        hardFlags: result.hardFlags,
        marketId: job.marketId,
        metadataHash: job.metadataHash,
        modelId: result.modelId ?? null,
        promptVersion: result.promptVersion,
        provider: result.provider,
        reasons: result.reasons,
        reviewedAt,
        scores: result.scores,
        sourceChecks: result.sourceChecks,
        verdict: result.verdict,
      })
      .returning();

    if (!review) {
      throw new Error("Failed to persist market AI review.");
    }

    const [updatedJob] = await tx
      .update(schema.marketAiReviewJobs)
      .set({
        completedAt: reviewedAt,
        lastError: null,
        leaseUntil: null,
        lockedBy: null,
        reviewId: review.id,
        status: "succeeded",
        updatedAt: reviewedAt,
      })
      .where(eq(schema.marketAiReviewJobs.id, job.id))
      .returning();

    if (!updatedJob) {
      throw new Error(`Failed to mark AI review job ${job.id} succeeded.`);
    }

    const targetMarketStatus = marketStatusForReviewVerdict(result.verdict);
    let transitionedMarket = false;

    if (targetMarketStatus) {
      // Guard on status and metadata hash so stale AI output cannot override a
      // market that the chain watcher or another runner has already moved.
      const rows = await tx
        .update(schema.markets)
        .set({
          status: targetMarketStatus,
          updatedAt: reviewedAt,
        })
        .where(
          and(
            eq(schema.markets.chainId, job.chainId),
            eq(schema.markets.marketId, job.marketId),
            eq(schema.markets.metadataHash, job.metadataHash),
            eq(schema.markets.status, "under_review"),
          ),
        )
        .returning({ id: schema.markets.id });

      transitionedMarket = rows.length > 0;
    }

    return {
      job: updatedJob,
      review,
      targetMarketStatus,
      transitionedMarket,
    };
  });
}

async function markReviewJobFailure({
  error,
  job,
  now,
  retryBaseMs,
}: {
  error: unknown;
  job: MarketAiReviewJobRow;
  now: Date;
  retryBaseMs: number;
}) {
  const attemptsExhausted = job.attemptCount >= job.maxAttempts;
  const status = attemptsExhausted ? "terminal_failed" : "retryable_failed";
  const retryDelayMs = calculateRetryDelayMs({
    attemptCount: job.attemptCount,
    baseMs: retryBaseMs,
  });

  const [updatedJob] = await db
    .update(schema.marketAiReviewJobs)
    .set({
      completedAt: attemptsExhausted ? now : null,
      lastError: compactError(error),
      leaseUntil: null,
      lockedBy: null,
      runAfter: attemptsExhausted
        ? now
        : new Date(now.getTime() + retryDelayMs),
      status,
      updatedAt: now,
    })
    .where(eq(schema.marketAiReviewJobs.id, job.id))
    .returning();

  if (!updatedJob) {
    throw new Error(`Failed to mark AI review job ${job.id} failed.`);
  }

  return updatedJob;
}

async function cancelReviewJob({
  job,
  now,
  reason,
}: {
  job: MarketAiReviewJobRow;
  now: Date;
  reason: string;
}) {
  const [updatedJob] = await db
    .update(schema.marketAiReviewJobs)
    .set({
      completedAt: now,
      lastError: reason,
      leaseUntil: null,
      lockedBy: null,
      status: "cancelled",
      updatedAt: now,
    })
    .where(eq(schema.marketAiReviewJobs.id, job.id))
    .returning();

  if (!updatedJob) {
    throw new Error(`Failed to cancel AI review job ${job.id}.`);
  }

  return updatedJob;
}

function claimableReviewJobCondition(now: Date) {
  return and(
    or(
      eq(schema.marketAiReviewJobs.status, "queued"),
      eq(schema.marketAiReviewJobs.status, "retryable_failed"),
      eq(schema.marketAiReviewJobs.status, "running"),
    ),
    lte(schema.marketAiReviewJobs.runAfter, now),
    // Running jobs become claimable only after their lease expires, which is how
    // another runner recovers work from a crashed process.
    or(
      isNull(schema.marketAiReviewJobs.leaseUntil),
      lte(schema.marketAiReviewJobs.leaseUntil, now),
    ),
  );
}

function noActiveReviewJobForCurrentMarket() {
  return sql`not exists (
    select 1
    from ${schema.marketAiReviewJobs}
    where ${schema.marketAiReviewJobs.chainId} = ${schema.markets.chainId}
      and ${schema.marketAiReviewJobs.marketId} = ${schema.markets.marketId}
      and ${schema.marketAiReviewJobs.metadataHash} = ${schema.markets.metadataHash}
      and ${schema.marketAiReviewJobs.status} in ('queued', 'running', 'retryable_failed')
  )`;
}

function noAiReviewForCurrentMarket() {
  return sql`not exists (
    select 1
    from ${schema.marketAiReviews}
    where ${schema.marketAiReviews.chainId} = ${schema.markets.chainId}
      and ${schema.marketAiReviews.marketId} = ${schema.markets.marketId}
      and ${schema.marketAiReviews.metadataHash} = ${schema.markets.metadataHash}
  )`;
}
