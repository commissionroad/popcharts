import type {
  MarketResolutionOptions,
  MarketResolutionRequest,
  ResolutionResult,
  ResolutionVerdict,
} from "src/ai-resolution/types";
import { and, asc, db, desc, eq, inArray, schema, sql } from "src/db/client";
import { recordLiveChange } from "src/change-feed/writer";

import { proposeMarketResolutionOnChain } from "./chain-resolution";
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
  proposeMarketResolutionOnChain: typeof proposeMarketResolutionOnChain;
  resolveMarketWithService: typeof resolveMarketWithService;
};

/**
 * Statuses under which a market may be turned into a NEW resolution job.
 * `graduated` only, and the narrowness is load-bearing (ADR 0026 review):
 * a `resolution_pending` market already carries someone's proposal, and if
 * that proposal was not this runner's, no `confirmed` row will ever exist for
 * it — so an eligible `resolution_pending` status turns the enqueue loop into
 * a hot cycle (enqueue → adopt → already-proposed → succeeded → re-enqueue,
 * with no sleep while work is claimed) that inserts job rows and hammers the
 * RPC for the whole dispute window. Under the outbox, crash recovery flows
 * through the still-active job via claim/retry, never through a new job, so
 * enqueue has no reason to look past `graduated`.
 */
const ENQUEUE_MARKET_STATUSES = ["graduated"] as const;

/**
 * Statuses under which an already-claimed job keeps processing rather than
 * cancelling. Wider than {@link ENQUEUE_MARKET_STATUSES} on purpose:
 * `resolution_pending` stays in so a retry can finish work its earlier attempt
 * started — adopt its own `pending` row and complete — after that attempt's
 * proposal moved the market out of `graduated`. Re-entry never submits a
 * second proposal: the contract refuses it (`_requireStatus(Trading)`) and the
 * runner reads that refusal out of the revert. `disputed` is deliberately
 * excluded: a contested proposal is waiting on a human, not on the AI.
 */
const RUNNER_ELIGIBLE_MARKET_STATUSES = [
  "graduated",
  "resolution_pending",
] as const;

/**
 * Terminal state of one processing attempt: cancelled (market left the
 * resolvable statuses), requeued (too early — not a failure), succeeded (audit
 * persisted, possibly proposed on-chain), a retryable/terminal failure, or
 * lease_lost — another runner reclaimed the job mid-attempt, so this attempt
 * wrote nothing and must not touch the job again.
 */
export type ResolutionJobOutcome =
  | { job: MarketResolutionJobRow; status: "cancelled" }
  | { job: MarketResolutionJobRow; status: "requeued" }
  | { job: MarketResolutionJobRow; status: "lease_lost" }
  | {
      job: MarketResolutionJobRow;
      proposedOnChain: boolean;
      resolution: MarketResolutionRow;
      status: "succeeded";
      verdict: ResolutionVerdict;
    }
  | {
      job: MarketResolutionJobRow;
      status: "retryable_failed" | "terminal_failed";
    };

/**
 * Thrown by the job-state writers when their fenced update matched nothing:
 * the lease expired and another runner owns the job now. The catch in
 * {@link processResolutionJob} converts it into a `lease_lost` outcome instead
 * of a failure — writing a failure would be exactly the unfenced overwrite the
 * fence exists to stop (ADR 0026 review: with the default batch size and model
 * timeout, a batch's tail job can outlive its lease in normal operation, not
 * just in pathological stalls).
 */
export class ResolutionJobLeaseLostError extends Error {
  constructor(jobId: number) {
    super(`Resolution job ${jobId} is no longer held by this runner.`);
  }
}

/**
 * Finds resolvable markets past their earliest resolution gate that have no
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
        // `graduated` only — see {@link ENQUEUE_MARKET_STATUSES} for why a
        // wider list is a hot-loop bug, not a convenience.
        inArray(schema.markets.status, [...ENQUEUE_MARKET_STATUSES]),
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
 * Runs one claimed job end to end: cancels if the market left the resolvable
 * statuses, calls the resolution service, applies the per-outcome gates,
 * submits proposeResolution() on confident in-window YES/NO, and persists the
 * audit row atomically with job completion. On error it schedules a backed-off
 * retry until maxAttempts.
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
  // Deliberately this predicate, matching the enqueue query above, rather than
  // `hasGraduated`: widening it for symmetry with the display-side predicates
  // would let a settled or contested market back in.
  if (!isRunnerEligibleMarketStatus(claimed.market.status)) {
    const job = await cancelResolutionJob({
      job: claimed.job,
      now,
      reason: `Market status is ${claimed.market.status}.`,
    });
    return { job, status: "cancelled" };
  }

  try {
    // An earlier attempt may already have committed its judgment and then died
    // before, during, or after the chain call. Resume from that row rather than
    // asking the model again: re-deriving a verdict is what let the record
    // disagree with the chain (ADR 0026).
    const adopted = await findResumableResolution(claimed.job);
    if (adopted && adopted.commitState !== "pending") {
      // Confirmed or superseded: the row is settled and there is nothing left
      // to submit — the chain already holds a proposal either way.
      const job = await completeResolutionJob({
        job: claimed.job,
        now,
        resolutionId: adopted.id,
      });
      return {
        job,
        proposedOnChain: false,
        resolution: adopted,
        status: "succeeded",
        verdict: adopted.verdict,
      };
    }

    if (adopted) {
      return await proposeAndComplete({
        claimed,
        dependencies,
        now,
        resolution: adopted,
      });
    }

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

    // Nothing irreversible follows a parked verdict, so there is no window to
    // protect: the row lands `confirmed` with the job, exactly as before.
    if (!decision.submit) {
      const persisted = await persistParkedResolution({
        job: claimed.job,
        postgradMarketAddress: claimed.postgradMarketAddress,
        resolvedAt: now,
        result,
        verdict: decision.verdict,
      });

      return {
        job: persisted.job,
        proposedOnChain: false,
        resolution: persisted.resolution,
        status: "succeeded",
        verdict: decision.verdict,
      };
    }

    const resolution = await persistPendingResolution({
      job: claimed.job,
      postgradMarketAddress: claimed.postgradMarketAddress,
      result,
      verdict: decision.verdict,
    });

    return await proposeAndComplete({ claimed, dependencies, now, resolution });
  } catch (error) {
    if (error instanceof ResolutionJobLeaseLostError) {
      return { job: claimed.job, status: "lease_lost" };
    }

    const job = await markResolutionJobFailure({
      error,
      job: claimed.job,
      now,
      retryBaseMs: config.backoffMs,
    });

    // The failure write is fenced too: null means the lease was lost while
    // this attempt was failing, and the new owner's state must stand.
    if (!job) {
      return { job: claimed.job, status: "lease_lost" };
    }

    return {
      job,
      status: job.status as "retryable_failed" | "terminal_failed",
    };
  }
}

/**
 * Submits the proposal for an already-committed judgment, then closes the job.
 *
 * Two transactions on purpose, with the chain call between them. The runner
 * never writes `commit_state = 'confirmed'` — that is the indexer's transition,
 * taken from the `ResolutionProposed` event (ADR 0026) — so a job can finish
 * while its row is still `pending`, and that is the expected steady state for
 * the moment between the transaction landing and the indexer seeing it.
 */
async function proposeAndComplete({
  claimed,
  dependencies,
  now,
  resolution,
}: {
  claimed: ClaimedResolutionJob;
  dependencies: ResolutionJobDependencies;
  now: Date;
  resolution: MarketResolutionRow;
}): Promise<ResolutionJobOutcome> {
  const proposal = await dependencies.proposeMarketResolutionOnChain({
    chainId: claimed.market.chainId,
    postgradMarketAddress: claimed.postgradMarketAddress,
    verdict: resolution.verdict,
  });

  const job = await completeResolutionJob({
    job: claimed.job,
    now,
    resolutionId: resolution.id,
  });

  return {
    job,
    proposedOnChain: proposal?.kind === "proposed",
    resolution,
    status: "succeeded",
    verdict: resolution.verdict,
  };
}

/**
 * The row a retry should resume from, if its earlier attempt left one. Scoped
 * to this job's exact market metadata version, which is what the partial unique
 * index constrains — so there is at most one `pending` row to find.
 */
async function findResumableResolution(job: MarketResolutionJobRow) {
  const [existing] = await db
    .select()
    .from(schema.marketResolutions)
    .where(
      and(
        eq(schema.marketResolutions.chainId, job.chainId),
        eq(schema.marketResolutions.marketId, job.marketId),
        eq(schema.marketResolutions.metadataHash, job.metadataHash),
      ),
    )
    .orderBy(desc(schema.marketResolutions.id))
    .limit(1);

  return existing;
}

/**
 * Commits the judgment before anything irreversible happens, and points the job
 * at it. One transaction: a row the job does not reference, or a job pointing at
 * nothing, would both leave the paper trail half written.
 */
async function persistPendingResolution({
  job,
  postgradMarketAddress,
  result,
  verdict,
}: {
  job: MarketResolutionJobRow;
  postgradMarketAddress: string;
  result: ResolutionResult;
  verdict: ResolutionVerdict;
}): Promise<MarketResolutionRow> {
  return await db.transaction(async (tx) => {
    const [resolution] = await tx
      .insert(schema.marketResolutions)
      .values({
        ...resolutionValues({ job, postgradMarketAddress, result, verdict }),
        // No `resolvedAt`: the block timestamp does not exist yet, and the
        // indexer stamps it from the confirming event.
        commitState: "pending",
      })
      .returning();

    if (!resolution) {
      throw new Error("Failed to persist market resolution.");
    }

    const linked = await tx
      .update(schema.marketResolutionJobs)
      .set({ resolutionId: resolution.id, updatedAt: new Date() })
      .where(ownedResolutionJob(job))
      .returning({ id: schema.marketResolutionJobs.id });

    // Losing the lease here rolls the judgment insert back too: the new owner
    // will run the model and write its own row, and an orphan pending row from
    // this attempt would only collide with it on the partial unique index.
    if (linked.length === 0) {
      throw new ResolutionJobLeaseLostError(job.id);
    }

    return resolution;
  });
}

/**
 * The fence every post-claim job write goes through: this runner still holds
 * the lease it claimed under (`locked_by`) and the job is still `running`. An
 * update matching nothing means another runner reclaimed the job after this
 * one's lease expired — the caller must stop, not overwrite (see
 * {@link ResolutionJobLeaseLostError}).
 */
function ownedResolutionJob(job: MarketResolutionJobRow) {
  return and(
    eq(schema.marketResolutionJobs.id, job.id),
    eq(schema.marketResolutionJobs.lockedBy, job.lockedBy ?? ""),
    eq(schema.marketResolutionJobs.status, "running"),
  );
}

/**
 * Closes a job whose proposal is submitted, or was already standing, pointing
 * it at the audit row it worked — the adopt path relies on this, because its
 * row was inserted by an earlier attempt that may never have linked it.
 */
async function completeResolutionJob({
  job,
  now,
  resolutionId,
}: {
  job: MarketResolutionJobRow;
  now: Date;
  resolutionId: number;
}) {
  const [updatedJob] = await db
    .update(schema.marketResolutionJobs)
    .set({
      completedAt: now,
      lastError: null,
      leaseUntil: null,
      lockedBy: null,
      resolutionId,
      status: "succeeded",
      updatedAt: now,
    })
    .where(ownedResolutionJob(job))
    .returning();

  if (!updatedJob) {
    throw new ResolutionJobLeaseLostError(job.id);
  }

  return updatedJob;
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

/** The judgment columns, shared by the pending and parked insert paths. */
function resolutionValues({
  job,
  postgradMarketAddress,
  result,
  verdict,
}: {
  job: MarketResolutionJobRow;
  postgradMarketAddress: string;
  result: ResolutionResult;
  verdict: ResolutionVerdict;
}) {
  return {
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
    sourceChecks: result.sourceChecks,
    verdict,
  };
}

/**
 * Writes a parked verdict and completes the job atomically — the pre-ADR 0026
 * shape, kept for `manual_review` and `cancel_draw`. These never reach the
 * chain, so the row is `confirmed` on arrival and no indexer event will ever
 * follow it.
 */
async function persistParkedResolution({
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
    // The job row is mutable queue state and points at the resolution that
    // completed it. The runner does NOT flip markets.status — a MarketResolved
    // indexer watcher is the canonical projector, since operator/self-resolve
    // paths also resolve.
    const [resolution] = await tx
      .insert(schema.marketResolutions)
      .values({
        ...resolutionValues({ job, postgradMarketAddress, result, verdict }),
        commitState: "confirmed",
        resolvedAt,
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

/**
 * Whether the runner should keep working a market in this indexed status.
 * See {@link RUNNER_ELIGIBLE_MARKET_STATUSES}.
 */
export function isRunnerEligibleMarketStatus(
  status: MarketRow["status"],
): boolean {
  return (RUNNER_ELIGIBLE_MARKET_STATUSES as readonly string[]).includes(
    status,
  );
}

const defaultResolutionJobDependencies: ResolutionJobDependencies = {
  proposeMarketResolutionOnChain,
  resolveMarketWithService,
};
