import type { MarketStatus } from "src/api/models/markets";
import type { MarketReviewRequest, ReviewResult } from "src/ai-review/types";
import { and, asc, db, desc, eq, inArray, schema, sql } from "src/db/client";
import { reviewMarketWithService } from "./client";
import { corroborateReview, type CorroboratedReview } from "./corroboration";
import { cancelReviewJob, markReviewJobFailure } from "./failures";
import {
  claimableReviewJobCondition,
  noActiveReviewJobForCurrentMarket,
  noAiReviewForCurrentMarket,
} from "./queries";
import {
  transitionReviewedMarketOnChain,
  type MarketReviewChainTransitionResult,
} from "./chain-review";
import type { AiReviewRunnerConfig } from "./config";

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

export type ReviewJobDependencies = {
  reviewMarketWithService: typeof reviewMarketWithService;
  transitionReviewedMarketOnChain: typeof transitionReviewedMarketOnChain;
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
  onlyMarket,
}: {
  limit: number;
  maxAttempts: number;
  now?: Date;
  /** Restrict eligibility to one market (the smoke pins its own). */
  onlyMarket?: { chainId: number; marketId: bigint; metadataHash: string };
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
        ...(onlyMarket
          ? [
              eq(schema.markets.chainId, onlyMarket.chainId),
              eq(schema.markets.marketId, onlyMarket.marketId),
              eq(schema.markets.metadataHash, onlyMarket.metadataHash),
            ]
          : []),
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
  dependencies = defaultReviewJobDependencies,
  now = new Date(),
}: {
  claimed: ClaimedReviewJob;
  config: AiReviewRunnerConfig;
  dependencies?: ReviewJobDependencies;
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
    const request = buildMarketReviewRequest(claimed);
    const corroborated = config.corroborationEnabled
      ? await corroborateReview({
          callService: () =>
            dependencies.reviewMarketWithService({ config, request }),
          // A corroborated review may spend up to three service-call budgets,
          // which can outlive one lease window — renew before each extra run
          // so another runner cannot claim the job mid-corroboration.
          onBeforeRun: async () => {
            await renewReviewJobLease({ config, job: claimed.job });
          },
        })
      : singleRunReview(
          await dependencies.reviewMarketWithService({ config, request }),
        );
    const { result } = corroborated;
    const targetMarketStatus = marketStatusForReviewVerdict(result.verdict);
    const chainTransition = targetMarketStatus
      ? await dependencies.transitionReviewedMarketOnChain({
          chainId: claimed.market.chainId,
          marketId: claimed.job.marketId,
          targetMarketStatus,
        })
      : null;

    const persisted = await persistReviewJobResult({
      chainTransition,
      corroborated,
      job: claimed.job,
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
 * Wraps a single service result in the corroboration shape so the persistence
 * path is uniform whether corroboration is enabled or not.
 */
function singleRunReview(result: ReviewResult): CorroboratedReview {
  return { outcome: "single_pass", result, runs: [result] };
}

/**
 * Pushes the job's lease out by one more lease window. Used between
 * corroboration runs; a no-op failure here is not acceptable — losing the
 * lease mid-corroboration would let a second runner double-review the market.
 */
async function renewReviewJobLease({
  config,
  job,
  now = new Date(),
}: {
  config: Pick<AiReviewRunnerConfig, "leaseMs" | "runnerId">;
  job: MarketAiReviewJobRow;
  now?: Date;
}): Promise<void> {
  const rows = await db
    .update(schema.marketAiReviewJobs)
    .set({
      leaseUntil: new Date(now.getTime() + config.leaseMs),
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.marketAiReviewJobs.id, job.id),
        // Only the holder may renew; if the lease was reclaimed the update
        // matches nothing and the corroboration attempt aborts loudly.
        eq(schema.marketAiReviewJobs.lockedBy, config.runnerId),
        eq(schema.marketAiReviewJobs.status, "running"),
      ),
    )
    .returning({ id: schema.marketAiReviewJobs.id });

  if (rows.length === 0) {
    throw new Error(
      `Lost the lease on AI review job ${job.id} mid-corroboration.`,
    );
  }
}

async function persistReviewJobResult({
  chainTransition,
  corroborated,
  job,
  reviewedAt,
}: {
  chainTransition: MarketReviewChainTransitionResult | null;
  corroborated: CorroboratedReview;
  job: MarketAiReviewJobRow;
  reviewedAt: Date;
}) {
  const { result } = corroborated;
  return await db.transaction(async (tx) => {
    // Review rows are append-only audit evidence: every corroboration run is
    // persisted in call order, and the deciding result is inserted LAST so
    // readers that pick the latest row (reviewedAt DESC, id DESC) always see
    // the verdict that actually governed the market. The job row is mutable
    // queue state and points at that deciding row.
    // Identity, not equality: a demoted decision synthesizes a new result
    // object, so every actual run (including the overruled one) persists as a
    // supporting row.
    const supportingRuns = corroborated.runs.filter((run) => run !== result);
    for (const run of supportingRuns) {
      await tx.insert(schema.marketAiReviews).values({
        chainId: job.chainId,
        evidence: run.evidence,
        hardFlags: run.hardFlags,
        marketId: job.marketId,
        metadataHash: job.metadataHash,
        modelId: run.modelId ?? null,
        promptVersion: run.promptVersion,
        provider: run.provider,
        reasons: run.reasons,
        reviewedAt,
        scoreRationales: run.scoreRationales,
        scores: run.scores,
        sourceChecks: run.sourceChecks,
        verdict: run.verdict,
      });
    }

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
        scoreRationales: result.scoreRationales,
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
      if (!chainTransition) {
        throw new Error(
          "Market review chain transition is required before updating market status.",
        );
      }

      // Guard on status and metadata hash so stale AI output cannot override a
      // market that the chain watcher or another runner has already moved.
      const rows = await tx
        .update(schema.markets)
        .set({
          status: targetMarketStatus,
          updatedAt: chainTransition.blockTimestamp,
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

const defaultReviewJobDependencies: ReviewJobDependencies = {
  reviewMarketWithService,
  transitionReviewedMarketOnChain,
};
