import type {
  MarketResolutionOptions,
  MarketResolutionRequest,
  ResolutionResult,
  ResolutionVerdict,
} from "src/ai-resolution/types";
import { and, asc, db, desc, eq, inArray, schema, sql } from "src/db/client";
import { recordLiveChange } from "src/change-feed/writer";

import { transitionResolvedMarketOnChain } from "./chain-resolution";
import { resolveMarketWithService } from "./client";
import type { AiResolutionRunnerConfig } from "./config";
import {
  cancelResolutionJob,
  markResolutionJobFailure,
  requeueResolutionJob,
} from "./failures";
import {
  claimableResolutionJobCondition,
  noActiveResolutionJobForCurrentMarket,
  noResolutionForCurrentMarket,
} from "./queries";

/** Drizzle select shape of a market_resolution_jobs queue row. */
export type MarketResolutionJobRow =
  typeof schema.marketResolutionJobs.$inferSelect;
/** Drizzle select shape of a market_resolutions audit row. */
export type MarketResolutionRow = typeof schema.marketResolutions.$inferSelect;
/** Drizzle select shape of a markets row. */
export type MarketRow = typeof schema.markets.$inferSelect;
/** Drizzle select shape of a market_metadata row. */
export type MarketMetadataRow = typeof schema.marketMetadata.$inferSelect;

/**
 * A leased job joined with the market, metadata, and the graduated child-market
 * address it will resolve — everything processResolutionJob needs.
 */
export type ClaimedResolutionJob = {
  job: MarketResolutionJobRow;
  market: MarketRow;
  metadata: MarketMetadataRow;
  postgradMarketAddress: `0x${string}`;
};

export type ResolutionJobDependencies = {
  resolveMarketWithService: typeof resolveMarketWithService;
  transitionResolvedMarketOnChain: typeof transitionResolvedMarketOnChain;
};

/**
 * Terminal state of one processing attempt: cancelled (market left graduated),
 * requeued (too early — not a failure), succeeded (audit persisted, possibly
 * submitted on-chain), or a retryable/terminal failure.
 */
export type ResolutionJobOutcome =
  | { job: MarketResolutionJobRow; status: "cancelled" }
  | { job: MarketResolutionJobRow; status: "requeued" }
  | {
      job: MarketResolutionJobRow;
      resolution: MarketResolutionRow;
      status: "succeeded";
      transitionedOnChain: boolean;
      verdict: ResolutionVerdict;
    }
  | {
      job: MarketResolutionJobRow;
      status: "retryable_failed" | "terminal_failed";
    };

/**
 * Finds graduated markets past their earliest resolution gate that have no
 * active job and no prior resolution, then turns them into queue rows. The
 * per-outcome NO gate is enforced later, at processing time; enqueue uses the
 * earliest gate (yes_not_before, falling back to resolution_time).
 */
export async function enqueueEligibleMarketResolutionJobs({
  limit,
  maxAttempts,
  now = new Date(),
}: {
  limit: number;
  maxAttempts: number;
  now?: Date;
}): Promise<MarketResolutionJobRow[]> {
  const candidates = await db
    .select({ market: schema.markets })
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
        eq(schema.markets.status, "graduated"),
        // Serialize the timestamp: raw sql fragments bypass drizzle's column
        // mapping, and the postgres-js driver crashes on a bare Date param
        // (jobs.int.test.ts is the regression guard).
        sql`coalesce(${schema.markets.yesNotBefore}, ${schema.markets.resolutionTime}) <= ${now.toISOString()}`,
        noActiveResolutionJobForCurrentMarket(),
        noResolutionForCurrentMarket(),
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
    marketId: market.marketId,
    maxAttempts,
    metadataHash: market.metadataHash,
    // The hard floor is the market's earliest legitimate resolution time.
    notBefore: market.yesNotBefore ?? market.resolutionTime,
    runAfter: now,
    trigger: "automatic" as const,
    updatedAt: now,
  }));

  return await db
    .insert(schema.marketResolutionJobs)
    .values(values)
    // The partial unique active-job index is the final race guard if two runner
    // processes discover the same market at the same time.
    .onConflictDoNothing()
    .returning();
}

/**
 * Leases due jobs using row locks, joining each to its graduated child-market
 * address so processing needs no further queries.
 */
export async function claimResolutionJobs({
  config,
  now = new Date(),
}: {
  config: Pick<AiResolutionRunnerConfig, "batchSize" | "leaseMs" | "runnerId">;
  now?: Date;
}): Promise<ClaimedResolutionJob[]> {
  return await db.transaction(async (tx) => {
    const claimableJobs = await tx
      .select({ id: schema.marketResolutionJobs.id })
      .from(schema.marketResolutionJobs)
      .where(claimableResolutionJobCondition(now))
      .orderBy(
        desc(schema.marketResolutionJobs.priority),
        asc(schema.marketResolutionJobs.runAfter),
        asc(schema.marketResolutionJobs.id),
      )
      .limit(config.batchSize)
      .for("update", { skipLocked: true });

    const jobIds = claimableJobs.map(({ id }) => id);
    if (jobIds.length === 0) {
      return [];
    }

    const leaseUntil = new Date(now.getTime() + config.leaseMs);
    await tx
      .update(schema.marketResolutionJobs)
      .set({
        attemptCount: sql`${schema.marketResolutionJobs.attemptCount} + 1`,
        leaseUntil,
        lockedBy: config.runnerId,
        status: "running",
        updatedAt: now,
      })
      .where(inArray(schema.marketResolutionJobs.id, jobIds));

    const claimed = await tx
      .select({
        job: schema.marketResolutionJobs,
        market: schema.markets,
        metadata: schema.marketMetadata,
        postgradMarket: schema.graduationFinalizedEvents.postgradMarket,
      })
      .from(schema.marketResolutionJobs)
      .innerJoin(
        schema.markets,
        and(
          eq(schema.markets.chainId, schema.marketResolutionJobs.chainId),
          eq(schema.markets.marketId, schema.marketResolutionJobs.marketId),
          eq(
            schema.markets.metadataHash,
            schema.marketResolutionJobs.metadataHash,
          ),
        ),
      )
      .innerJoin(
        schema.marketMetadata,
        and(
          eq(
            schema.marketMetadata.chainId,
            schema.marketResolutionJobs.chainId,
          ),
          eq(
            schema.marketMetadata.metadataHash,
            schema.marketResolutionJobs.metadataHash,
          ),
        ),
      )
      .innerJoin(
        schema.graduationFinalizedEvents,
        and(
          eq(
            schema.graduationFinalizedEvents.chainId,
            schema.marketResolutionJobs.chainId,
          ),
          eq(
            schema.graduationFinalizedEvents.marketId,
            schema.marketResolutionJobs.marketId,
          ),
        ),
      )
      .where(inArray(schema.marketResolutionJobs.id, jobIds));

    // A reorg-replayed graduation can leave more than one finalized-event row
    // per market (all with the same postgrad address), so dedupe by job id.
    const byJobId = new Map<number, ClaimedResolutionJob>();
    for (const row of claimed) {
      if (byJobId.has(row.job.id)) {
        continue;
      }
      byJobId.set(row.job.id, {
        job: row.job,
        market: row.market,
        metadata: row.metadata,
        postgradMarketAddress: row.postgradMarket as `0x${string}`,
      });
    }

    const order = new Map(jobIds.map((id, index) => [id, index]));
    return [...byJobId.values()].sort(
      (left, right) =>
        (order.get(left.job.id) ?? 0) - (order.get(right.job.id) ?? 0),
    );
  });
}

type ResolutionDecision =
  | { kind: "requeue"; reason: string; runAfter: Date }
  | { kind: "persist"; submit: boolean; verdict: ResolutionVerdict };

/**
 * Applies the per-outcome time gates the service does not know about. A YES/NO
 * that arrives before its on-chain floor is re-queued rather than submitted (the
 * on-chain guard would revert it anyway); `too_early` re-queues with backoff but
 * escalates to manual review once past the deadline so a stuck market reaches an
 * operator; draws and manual reviews park with an audit row and no submission.
 */
export function decideResolutionAction({
  backoffMs,
  market,
  now,
  result,
}: {
  backoffMs: number;
  market: Pick<MarketRow, "resolutionTime" | "yesNotBefore">;
  now: Date;
  result: Pick<ResolutionResult, "verdict">;
}): ResolutionDecision {
  const noNotBefore = market.resolutionTime;
  const yesGate = market.yesNotBefore ?? market.resolutionTime;

  switch (result.verdict) {
    case "resolve_yes":
      if (now < yesGate) {
        return {
          kind: "requeue",
          reason: "YES decided before yes_not_before; re-queued to the gate.",
          runAfter: yesGate,
        };
      }
      return { kind: "persist", submit: true, verdict: "resolve_yes" };
    case "resolve_no":
      if (now < noNotBefore) {
        return {
          kind: "requeue",
          reason: "NO decided before no_not_before; re-queued to the deadline.",
          runAfter: noNotBefore,
        };
      }
      return { kind: "persist", submit: true, verdict: "resolve_no" };
    case "requeue_too_early":
      if (now >= noNotBefore) {
        // Bounded escalation: past the deadline a persistent too_early is an
        // operator problem, not something to re-queue forever.
        return { kind: "persist", submit: false, verdict: "manual_review" };
      }
      return {
        kind: "requeue",
        reason: "Event not concluded; re-queued with backoff.",
        runAfter: new Date(now.getTime() + backoffMs),
      };
    case "cancel_draw":
    case "manual_review":
      return { kind: "persist", submit: false, verdict: result.verdict };
  }
}

/**
 * Runs one claimed job end to end: cancels if the market left graduated, calls
 * the resolution service, applies the per-outcome gates, submits resolve() on
 * confident in-window YES/NO, and persists the audit row atomically with job
 * completion. On error it schedules a backed-off retry until maxAttempts.
 */
export async function processResolutionJob({
  claimed,
  config,
  dependencies = defaultResolutionJobDependencies,
  now = new Date(),
}: {
  claimed: ClaimedResolutionJob;
  config: AiResolutionRunnerConfig;
  dependencies?: ResolutionJobDependencies;
  now?: Date;
}): Promise<ResolutionJobOutcome> {
  if (claimed.market.status !== "graduated") {
    const job = await cancelResolutionJob({
      job: claimed.job,
      now,
      reason: `Market status is ${claimed.market.status}.`,
    });
    return { job, status: "cancelled" };
  }

  try {
    const result = await dependencies.resolveMarketWithService({
      config,
      request: buildMarketResolutionRequest(claimed),
    });
    const decision = decideResolutionAction({
      backoffMs: config.backoffMs,
      market: claimed.market,
      now,
      result,
    });

    if (decision.kind === "requeue") {
      const job = await requeueResolutionJob({
        job: claimed.job,
        now,
        reason: decision.reason,
        runAfter: decision.runAfter,
      });
      return { job, status: "requeued" };
    }

    const chainTransition = decision.submit
      ? await dependencies.transitionResolvedMarketOnChain({
          chainId: claimed.market.chainId,
          postgradMarketAddress: claimed.postgradMarketAddress,
          verdict: decision.verdict,
        })
      : null;

    const persisted = await persistResolutionJobResult({
      job: claimed.job,
      postgradMarketAddress: claimed.postgradMarketAddress,
      resolvedAt: chainTransition?.blockTimestamp ?? now,
      result,
      verdict: decision.verdict,
    });

    return {
      job: persisted.job,
      resolution: persisted.resolution,
      status: "succeeded",
      transitionedOnChain: chainTransition?.kind === "transitioned",
      verdict: decision.verdict,
    };
  } catch (error) {
    const job = await markResolutionJobFailure({
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
 * Builds the stateless resolution request from persisted rows. Job-level
 * provider/model overrides are honored; market text never chooses provider,
 * model, or web mode.
 */
export function buildMarketResolutionRequest({
  job,
  market,
  metadata,
  postgradMarketAddress,
}: ClaimedResolutionJob): MarketResolutionRequest {
  const options: MarketResolutionOptions = {};
  if (job.requestedProvider && job.requestedProvider !== "manual") {
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
      postgradMarketAddress,
    },
    metadata: {
      category: metadata.category,
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
      ...(metadata.observationWindowStart
        ? {
            observationWindowStart:
              metadata.observationWindowStart.toISOString(),
          }
        : {}),
      ...(metadata.observationWindowEnd
        ? { observationWindowEnd: metadata.observationWindowEnd.toISOString() }
        : {}),
    },
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}

async function persistResolutionJobResult({
  job,
  postgradMarketAddress,
  resolvedAt,
  result,
  verdict,
}: {
  job: MarketResolutionJobRow;
  postgradMarketAddress: string;
  resolvedAt: Date;
  result: ResolutionResult;
  verdict: ResolutionVerdict;
}) {
  return await db.transaction(async (tx) => {
    // The resolution row is append-only audit evidence; the job row is mutable
    // queue state and points at the resolution that completed it. The runner
    // does NOT flip markets.status — a MarketResolved indexer watcher is the
    // canonical projector, since operator/self-resolve paths also resolve.
    const [resolution] = await tx
      .insert(schema.marketResolutions)
      .values({
        chainId: job.chainId,
        confidence: result.confidence ?? null,
        evidence: result.evidence,
        hardFlags: result.hardFlags,
        marketId: job.marketId,
        metadataHash: job.metadataHash,
        modelId: result.modelId ?? null,
        outcome: result.outcome,
        postgradMarketAddress,
        promptVersion: result.promptVersion,
        provider: result.provider,
        reasons: result.reasons,
        resolvedAt,
        sourceChecks: result.sourceChecks,
        verdict,
      })
      .returning();

    if (!resolution) {
      throw new Error("Failed to persist market resolution.");
    }

    const [updatedJob] = await tx
      .update(schema.marketResolutionJobs)
      .set({
        completedAt: resolvedAt,
        lastError: null,
        leaseUntil: null,
        lockedBy: null,
        resolutionId: resolution.id,
        status: "succeeded",
        updatedAt: resolvedAt,
      })
      .where(eq(schema.marketResolutionJobs.id, job.id))
      .returning();

    if (!updatedJob) {
      throw new Error(`Failed to mark resolution job ${job.id} succeeded.`);
    }

    // Signal the market page + board badge that a resolution decision landed,
    // atomic with the resolution/job writes. Off-chain: ordered by change_feed
    // id, no block version. The on-chain MarketResolved event separately flips
    // markets.status and carries its own signal.
    await recordLiveChange(tx, {
      sourceTable: "market_resolutions",
      op: "insert",
      chainId: job.chainId,
      marketId: job.marketId,
      rowId: resolution.id,
    });

    return { job: updatedJob, resolution };
  });
}

const defaultResolutionJobDependencies: ResolutionJobDependencies = {
  resolveMarketWithService,
  transitionResolvedMarketOnChain,
};
