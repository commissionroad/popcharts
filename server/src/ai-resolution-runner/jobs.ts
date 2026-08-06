import type { MarketSide } from "@popcharts/protocol";

import type {
  MarketResolutionOptions,
  MarketResolutionRequest,
  ResolutionResult,
  ResolutionVerdict,
} from "src/ai-resolution/types";
import { and, asc, db, desc, eq, inArray, schema, sql } from "src/db/client";
import { recordLiveChange } from "src/change-feed/writer";

import {
  chainSideVerdict,
  type MarketResolutionProposalResult,
  type OnChainResolutionProposal,
  proposeMarketResolutionOnChain,
  readOnChainResolutionProposal,
} from "./chain-resolution";
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

/**
 * The chain and model calls one job makes, injectable so tests drive the whole
 * path without an RPC or a provider. The read-only chain call is separate from
 * the propose call on purpose: the stand-down path is handed only the former.
 */
export type ResolutionJobDependencies = {
  proposeMarketResolutionOnChain: typeof proposeMarketResolutionOnChain;
  readOnChainResolutionProposal: typeof readOnChainResolutionProposal;
  resolveMarketWithService: typeof resolveMarketWithService;
};

/**
 * Statuses a market may be in and still be the runner's business. `graduated`
 * is the normal entry point; `resolution_pending` keeps a market whose proposal
 * already landed on-chain in scope so the runner can finish its own work — an
 * attempt that proposed but failed before persisting its audit row retries
 * against a market that is no longer `graduated`. `disputed` is deliberately
 * excluded: a contested proposal is waiting on a human, not on the AI. That
 * exclusion governs *acting* only — see {@link RUNNER_AUDIT_ONLY_MARKET_STATUSES}
 * for the read-only path that still writes the audit row such a market is owed.
 *
 * These two gates were pinned to the bare `graduated` literal before the runner
 * proposed instead of resolved, because re-entering a market mid-window meant a
 * second `proposeResolution` — a revert at best. That is no longer how it ends:
 * `proposeMarketResolutionOnChain` reads the contract status first and returns
 * `already_on_chain` for ResolutionPending/Disputed/Resolved, so re-entry
 * finishes the audit row without a second on-chain write. Narrow these back
 * only together with that guard.
 */
const RUNNER_ELIGIBLE_MARKET_STATUSES = [
  "graduated",
  "resolution_pending",
] as const;

/**
 * Statuses the runner must not act on, but which still carry an on-chain
 * resolution proposal the audit trail has to explain. Standing down on one of
 * these without writing the row is how the evidence disappears: the proposal is
 * permanent, the job is closed, and the enqueue query never returns.
 *
 * The window is real. An attempt that proposed but died before persisting
 * leaves a retryable job; a disputer moving the market to `disputed` (or the
 * keeper finalizing it to `resolved`) before that retry lands turns a recoverable
 * failure into a permanent hole — precisely when an operator is being asked to
 * overrule a verdict whose reasoning was never written down.
 */
const RUNNER_AUDIT_ONLY_MARKET_STATUSES = ["disputed", "resolved"] as const;

/**
 * Marks an audit row whose verdict was taken from the chain because the model
 * re-run disagreed with the proposal already standing. Reading it means: trust
 * `verdict` for what happened, and `outcome`/`reasons` for what a later look at
 * the evidence concluded.
 */
export const CHAIN_VERDICT_DIVERGENCE_HARD_FLAG = "chain_verdict_divergence";

/**
 * Terminal state of one processing attempt: cancelled (market left the
 * resolvable statuses), requeued (too early — not a failure), succeeded (audit
 * persisted, possibly proposed on-chain), or a retryable/terminal failure.
 */
export type ResolutionJobOutcome =
  | {
      job: MarketResolutionJobRow;
      // Present when the job stood down from a market that already carried an
      // on-chain proposal, and wrote the missing audit row on its way out.
      resolution?: MarketResolutionRow;
      status: "cancelled";
    }
  | { job: MarketResolutionJobRow; status: "requeued" }
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
        // Deliberately this list, not `hasGraduated`: `disputed` is waiting on
        // an operator rather than on another AI verdict, and nothing before
        // graduation has a market to propose on. See
        // {@link RUNNER_ELIGIBLE_MARKET_STATUSES} for why `resolution_pending`
        // is in scope. `noResolutionForCurrentMarket` only blocks a *completed*
        // job's audit row, so this status pin is the independent guard against
        // enqueueing a market the runner has no work left on.
        inArray(schema.markets.status, [...RUNNER_ELIGIBLE_MARKET_STATUSES]),
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
 * What to do with a job whose market has left the runner-eligible statuses.
 * `cancel` closes it as before. `record_then_cancel` means the market may still
 * be owed an audit row, so the chain gets one read before the job closes — the
 * runner never proposes down this path, it only writes down what already
 * happened.
 */
export function decideStandDownAction({
  hasResolution,
  status,
}: {
  hasResolution: boolean;
  status: MarketRow["status"];
}): "cancel" | "record_then_cancel" {
  if (hasResolution) {
    return "cancel";
  }

  return isRunnerAuditOnlyMarketStatus(status)
    ? "record_then_cancel"
    : "cancel";
}

/**
 * Reconciles a model verdict against the proposal the chain actually carries.
 *
 * A retry re-runs the model from scratch, so it can reach a different verdict
 * than the attempt that proposed — fresh evidence, a changed source, a
 * non-deterministic model. The chain is the act that moved money, so it wins the
 * `verdict` column; the model's own `outcome` and `reasons` are preserved
 * untouched, and the disagreement is recorded rather than silently discarded.
 */
export function reconcileVerdictWithChain({
  proposedSide,
  result,
  verdict,
}: {
  proposedSide: MarketSide;
  result: ResolutionResult;
  verdict: ResolutionVerdict;
}): { result: ResolutionResult; verdict: ResolutionVerdict } {
  const chainVerdict = chainSideVerdict(proposedSide);
  if (chainVerdict === verdict) {
    return { result, verdict };
  }

  return {
    result: {
      ...result,
      hardFlags: [...result.hardFlags, CHAIN_VERDICT_DIVERGENCE_HARD_FLAG],
      reasons: [
        `Recorded ${chainVerdict} to match the proposal already on-chain; this run concluded ${verdict}.`,
        ...result.reasons,
      ],
    },
    verdict: chainVerdict,
  };
}

/**
 * Runs one claimed job end to end: stands down if the market left the resolvable
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
    return await standDownResolutionJob({
      claimed,
      config,
      dependencies,
      now,
    });
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

    // A non-submitting verdict still needs the chain read. `resolution_pending`
    // is an eligible status, so a re-run that lands on manual_review or
    // cancel_draw can be looking at a market whose proposal already stands —
    // writing its own verdict there would contradict the act that moved the
    // money. Reading returns null for a market carrying no proposal, which is
    // every `graduated` job, so the cost is one status() call.
    const proposal:
      MarketResolutionProposalResult | OnChainResolutionProposal | null =
      decision.submit
        ? await dependencies.proposeMarketResolutionOnChain({
            chainId: claimed.market.chainId,
            postgradMarketAddress: claimed.postgradMarketAddress,
            verdict: decision.verdict,
          })
        : await dependencies.readOnChainResolutionProposal({
            chainId: claimed.market.chainId,
            postgradMarketAddress: claimed.postgradMarketAddress,
          });

    // A proposal this run did not submit — an earlier attempt of this same job,
    // or another actor — means the chain holds a side this run never chose.
    // Record what the chain holds, not what this run happened to reach.
    const reconciled = proposal
      ? reconcileVerdictWithChain({
          proposedSide: proposal.proposedSide,
          result,
          verdict: decision.verdict,
        })
      : { result, verdict: decision.verdict };

    const persisted = await persistResolutionJobResult({
      job: claimed.job,
      postgradMarketAddress: claimed.postgradMarketAddress,
      resolvedAt: proposal?.blockTimestamp ?? now,
      result: reconciled.result,
      verdict: reconciled.verdict,
    });

    return {
      job: persisted.job,
      proposedOnChain:
        proposal !== null && "kind" in proposal && proposal.kind === "proposed",
      resolution: persisted.resolution,
      status: "succeeded",
      verdict: reconciled.verdict,
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
 * Closes a job whose market the runner may no longer act on, writing the missing
 * audit row first when the market already carries an on-chain proposal nothing
 * has explained.
 *
 * The rescue re-runs the model, because the attempt that proposed took its
 * evidence to the grave when its write failed. The verdict still comes from the
 * chain — {@link reconcileVerdictWithChain} — so a fresh run that changes its
 * mind annotates the record instead of contradicting it.
 *
 * A failure here is deliberately retryable rather than a cancel: leaving the job
 * alive gives the audit row another chance, and an exhausted job lands in
 * `terminal_failed`, which is visible, instead of a silent `cancelled`.
 */
async function standDownResolutionJob({
  claimed,
  config,
  dependencies,
  now,
}: {
  claimed: ClaimedResolutionJob;
  config: AiResolutionRunnerConfig;
  dependencies: ResolutionJobDependencies;
  now: Date;
}): Promise<ResolutionJobOutcome> {
  const reason = `Market status is ${claimed.market.status}.`;

  try {
    const action = decideStandDownAction({
      hasResolution: await hasPersistedResolution(claimed.job),
      status: claimed.market.status,
    });

    if (action === "cancel") {
      const job = await cancelResolutionJob({ job: claimed.job, now, reason });
      return { job, status: "cancelled" };
    }

    // Read-only by construction: this cannot reach proposeResolution(), so a
    // market the runner has been told to leave alone stays untouched even if
    // the indexed status and the contract disagree.
    const proposal = await dependencies.readOnChainResolutionProposal({
      chainId: claimed.market.chainId,
      postgradMarketAddress: claimed.postgradMarketAddress,
    });

    if (!proposal) {
      const job = await cancelResolutionJob({ job: claimed.job, now, reason });
      return { job, status: "cancelled" };
    }

    const result = await dependencies.resolveMarketWithService({
      config,
      request: buildMarketResolutionRequest(claimed),
    });
    // The model's own verdict goes in, not the chain's: passing the chain
    // verdict here would compare it against itself and never record that the
    // re-run disagreed. Gates are deliberately skipped — the proposal is already
    // standing, so there is nothing left to hold back.
    const reconciled = reconcileVerdictWithChain({
      proposedSide: proposal.proposedSide,
      result,
      verdict: result.verdict,
    });

    const persisted = await persistResolutionJobResult({
      job: claimed.job,
      jobCompletion: {
        reason: `${reason} Recorded the audit row for the proposal already on-chain.`,
        status: "cancelled",
      },
      postgradMarketAddress: claimed.postgradMarketAddress,
      resolvedAt: proposal.blockTimestamp,
      result: reconciled.result,
      verdict: reconciled.verdict,
    });

    return {
      job: persisted.job,
      resolution: persisted.resolution,
      status: "cancelled",
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

/** Whether this market already has the audit row the job would write. */
async function hasPersistedResolution(job: MarketResolutionJobRow) {
  const [existing] = await db
    .select({ id: schema.marketResolutions.id })
    .from(schema.marketResolutions)
    .where(
      and(
        eq(schema.marketResolutions.chainId, job.chainId),
        eq(schema.marketResolutions.marketId, job.marketId),
        eq(schema.marketResolutions.metadataHash, job.metadataHash),
      ),
    )
    .limit(1);

  return existing !== undefined;
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

/**
 * Writes the audit row and closes the job in one transaction. `jobCompletion`
 * decides how the job closes: `succeeded` for the normal path, `cancelled` for a
 * stand-down that recorded a proposal it did not make. Either way the row and
 * the job's pointer at it land together, so the paper trail cannot be half
 * written.
 */
async function persistResolutionJobResult({
  job,
  jobCompletion = { reason: null, status: "succeeded" },
  postgradMarketAddress,
  resolvedAt,
  result,
  verdict,
}: {
  job: MarketResolutionJobRow;
  jobCompletion?: {
    reason: string | null;
    status: "cancelled" | "succeeded";
  };
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
        lastError: jobCompletion.reason,
        leaseUntil: null,
        lockedBy: null,
        resolutionId: resolution.id,
        status: jobCompletion.status,
        updatedAt: resolvedAt,
      })
      .where(eq(schema.marketResolutionJobs.id, job.id))
      .returning();

    if (!updatedJob) {
      throw new Error(
        `Failed to mark resolution job ${job.id} ${jobCompletion.status}.`,
      );
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

/**
 * Whether a market the runner may not act on could still be owed an audit row.
 * See {@link RUNNER_AUDIT_ONLY_MARKET_STATUSES}.
 */
export function isRunnerAuditOnlyMarketStatus(
  status: MarketRow["status"],
): boolean {
  return (RUNNER_AUDIT_ONLY_MARKET_STATUSES as readonly string[]).includes(
    status,
  );
}

const defaultResolutionJobDependencies: ResolutionJobDependencies = {
  proposeMarketResolutionOnChain,
  readOnChainResolutionProposal,
  resolveMarketWithService,
};
