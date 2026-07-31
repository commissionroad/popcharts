import { aiReviewConfig } from "src/ai-review/config";
import { reviewMarket } from "src/ai-review/reviewer";
import {
  REVIEW_PROVIDER_NAMES,
  type MarketReviewRequest,
  type ReviewProviderName,
  type ReviewResult,
} from "src/ai-review/types";
import { applyDraftReviewResult } from "src/api/services/market-drafts";
import {
  and,
  db,
  eq,
  inArray,
  lte,
  or,
  isNull,
  schema,
  sql,
} from "src/db/client";
import { buildDraftReviewMetadata } from "src/draft-review/content";

const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;
const LEASE_MS = 5 * 60_000;

/**
 * The provider drafts review with. Deliberately defaults to the deterministic
 * heuristic — the draft loop runs in-process with the API, where a slow or
 * paid model default would be a surprise; opt into a model provider with
 * POPCHARTS_DRAFT_REVIEW_PROVIDER.
 */
export function draftReviewProvider(
  env: Record<string, string | undefined> = process.env,
): ReviewProviderName {
  const requested = env.POPCHARTS_DRAFT_REVIEW_PROVIDER;

  if (
    requested &&
    (REVIEW_PROVIDER_NAMES as readonly string[]).includes(requested)
  ) {
    return requested as ReviewProviderName;
  }

  return "heuristic";
}

export type DraftReviewJobOutcome = {
  draftId: number;
  jobId: number;
  outcome: "cancelled" | "failed" | "succeeded";
  verdict?: ReviewResult["verdict"];
};

export type ProcessDraftReviewJobsDependencies = {
  review: (request: MarketReviewRequest) => Promise<ReviewResult>;
};

const defaultDependencies: ProcessDraftReviewJobsDependencies = {
  review: (request) =>
    reviewMarket({
      config: { ...aiReviewConfig, provider: draftReviewProvider() },
      request,
    }),
};

/**
 * One sweep of the draft review queue: claim due jobs, review each draft's
 * snapshot, and apply the verdict as a draft-state transition. Runs in-process
 * with the API (started from its main block); the leased-job table keeps it
 * safe to also run elsewhere later.
 */
export async function processDraftReviewJobsOnce(
  {
    batchSize = 3,
    now = new Date(),
    runnerId = "api-inline",
  }: { batchSize?: number; now?: Date; runnerId?: string } = {},
  dependencies: ProcessDraftReviewJobsDependencies = defaultDependencies,
): Promise<DraftReviewJobOutcome[]> {
  const jobs = await claimDraftReviewJobs({ batchSize, now, runnerId });
  const outcomes: DraftReviewJobOutcome[] = [];

  for (const job of jobs) {
    outcomes.push(await processClaimedJob(job, dependencies));
  }

  return outcomes;
}

type ClaimedJob = typeof schema.marketDraftReviewJobs.$inferSelect;

async function claimDraftReviewJobs({
  batchSize,
  now,
  runnerId,
}: {
  batchSize: number;
  now: Date;
  runnerId: string;
}): Promise<ClaimedJob[]> {
  return db.transaction(async (tx) => {
    const claimable = await tx
      .select({ id: schema.marketDraftReviewJobs.id })
      .from(schema.marketDraftReviewJobs)
      .where(
        and(
          inArray(schema.marketDraftReviewJobs.status, [
            "queued",
            "running",
            "retryable_failed",
          ]),
          lte(schema.marketDraftReviewJobs.runAfter, now),
          or(
            isNull(schema.marketDraftReviewJobs.leaseUntil),
            lte(schema.marketDraftReviewJobs.leaseUntil, now),
          ),
        ),
      )
      .orderBy(
        schema.marketDraftReviewJobs.runAfter,
        schema.marketDraftReviewJobs.id,
      )
      .limit(batchSize)
      .for("update", { skipLocked: true });

    if (claimable.length === 0) {
      return [];
    }

    const ids = claimable.map((row) => row.id);
    const claimed = await tx
      .update(schema.marketDraftReviewJobs)
      .set({
        attemptCount: sql`${schema.marketDraftReviewJobs.attemptCount} + 1`,
        leaseUntil: new Date(now.getTime() + LEASE_MS),
        lockedBy: runnerId,
        status: "running",
        updatedAt: now,
      })
      .where(inArray(schema.marketDraftReviewJobs.id, ids))
      .returning();

    return claimed;
  });
}

async function processClaimedJob(
  job: ClaimedJob,
  dependencies: ProcessDraftReviewJobsDependencies,
): Promise<DraftReviewJobOutcome> {
  const drafts = await db
    .select()
    .from(schema.marketDrafts)
    .where(eq(schema.marketDrafts.id, job.draftId))
    .limit(1);
  const draft = drafts[0];

  // A draft that moved on (edited, deleted, withdrawn) makes the snapshot
  // stale — cancel rather than review text nobody submitted.
  if (
    !draft ||
    draft.status !== "in_review" ||
    draft.submittedMetadataHash !== job.metadataHash
  ) {
    await db
      .update(schema.marketDraftReviewJobs)
      .set({
        completedAt: new Date(),
        lastError: "Draft left review before the job ran.",
        leaseUntil: null,
        lockedBy: null,
        status: "cancelled",
        updatedAt: new Date(),
      })
      .where(eq(schema.marketDraftReviewJobs.id, job.id));

    return { draftId: job.draftId, jobId: job.id, outcome: "cancelled" };
  }

  try {
    const result = await dependencies.review({
      context: {},
      metadata: buildDraftReviewMetadata(draft, job.metadataHash),
    });
    const { reviewId } = await applyDraftReviewResult({
      draftId: draft.id,
      metadataHash: job.metadataHash,
      result,
    });
    await db
      .update(schema.marketDraftReviewJobs)
      .set({
        completedAt: new Date(),
        lastError: null,
        leaseUntil: null,
        lockedBy: null,
        reviewId,
        status: "succeeded",
        updatedAt: new Date(),
      })
      .where(eq(schema.marketDraftReviewJobs.id, job.id));

    return {
      draftId: draft.id,
      jobId: job.id,
      outcome: "succeeded",
      verdict: result.verdict,
    };
  } catch (error) {
    await recordJobFailure(job, error);

    return { draftId: job.draftId, jobId: job.id, outcome: "failed" };
  }
}

async function recordJobFailure(job: ClaimedJob, error: unknown) {
  // The claim update already counted this attempt into the returned row.
  const attemptCount = job.attemptCount;
  const terminal = attemptCount >= job.maxAttempts;
  const backoffMs = Math.min(
    RETRY_BASE_MS * 2 ** Math.max(attemptCount - 1, 0),
    RETRY_MAX_MS,
  );
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  await db
    .update(schema.marketDraftReviewJobs)
    .set({
      ...(terminal ? { completedAt: new Date() } : {}),
      lastError: message.slice(0, 800),
      leaseUntil: null,
      lockedBy: null,
      runAfter: new Date(Date.now() + backoffMs),
      status: terminal ? "terminal_failed" : "retryable_failed",
      updatedAt: new Date(),
    })
    .where(eq(schema.marketDraftReviewJobs.id, job.id));

  // The creator should not be stuck on a silent terminal failure: surface it
  // as a changes-requested style transition would be dishonest, so release
  // the draft back to editing with no review row.
  if (terminal) {
    await db
      .update(schema.marketDrafts)
      .set({ status: "editing", updatedAt: new Date() })
      .where(
        and(
          eq(schema.marketDrafts.id, job.draftId),
          eq(schema.marketDrafts.status, "in_review"),
          eq(schema.marketDrafts.submittedMetadataHash, job.metadataHash),
        ),
      );
  }
}

/**
 * Starts the in-process polling loop. Returns a stop function; overlapping
 * sweeps are prevented by awaiting each pass before scheduling the next.
 */
export function startDraftReviewRunner({
  intervalMs = 1_000,
  onError = (error: unknown) =>
    console.error("[draft-review] sweep failed", error),
}: {
  intervalMs?: number;
  onError?: (error: unknown) => void;
} = {}): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped) {
      return;
    }

    try {
      await processDraftReviewJobsOnce();
    } catch (error) {
      onError(error);
    }

    if (!stopped) {
      timer = setTimeout(tick, intervalMs);
    }
  };

  timer = setTimeout(tick, intervalMs);

  return () => {
    stopped = true;

    if (timer) {
      clearTimeout(timer);
    }
  };
}
