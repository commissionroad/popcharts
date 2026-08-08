import { aiReviewConfig, type AiReviewConfig } from "src/ai-review/config";
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
import { readBoolean } from "src/shared/config-env";
import { buildDraftReviewMetadata } from "src/draft-review/content";
import { corroborateReview } from "src/draft-review/corroboration";

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

/**
 * Whether terminal verdicts from a model provider must be corroborated by an
 * agreeing rerun before they commit (ADR 0019). The configured `heuristic`
 * provider is exempt inside corroborateReview — deterministic reruns cannot
 * disagree — so the default local path stays single-call.
 */
export function draftReviewCorroborationEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return readBoolean(
    env.POPCHARTS_DRAFT_REVIEW_CORROBORATION,
    true,
    "POPCHARTS_DRAFT_REVIEW_CORROBORATION",
  );
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

/**
 * The exact service config the runner's default dependency reviews with,
 * exported as a pure function so a test can pin the wiring.
 * `retryProviderFailures: true` is load-bearing for ADR 0019: this runner is
 * the durable consumer the reviewer docs describe, so provider failures must
 * throw into the job's retry/backoff path. The degraded fallback result
 * would count as an agreeing corroboration run, letting a terminal verdict
 * commit off a single real model run — and corroboration reads pre-stage
 * provenance off `provider: "heuristic"`, which is only unambiguous while
 * outages throw instead of degrading.
 */
export function draftReviewCallConfig(
  env: Record<string, string | undefined> = process.env,
): AiReviewConfig {
  return {
    ...aiReviewConfig,
    provider: draftReviewProvider(env),
    retryProviderFailures: true,
  };
}

const defaultDependencies: ProcessDraftReviewJobsDependencies = {
  review: (request) =>
    reviewMarket({ config: draftReviewCallConfig(), request }),
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
    outcomes.push(await processClaimedJob(job, runnerId, dependencies));
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
  runnerId: string,
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
      .where(claimedBy(job, runnerId));

    return { draftId: job.draftId, jobId: job.id, outcome: "cancelled" };
  }

  try {
    const request = {
      context: {},
      metadata: buildDraftReviewMetadata(draft, job.metadataHash),
    };
    const corroborated = draftReviewCorroborationEnabled()
      ? await corroborateReview({
          callService: () => dependencies.review(request),
          configuredProvider: draftReviewProvider(),
          onBeforeRun: () => renewDraftReviewJobLease(job, runnerId),
        })
      : null;
    const result = corroborated
      ? corroborated.result
      : await dependencies.review(request);
    // Identity, not equality: a demoted deciding result is synthesized, so
    // every actual service run stays in the supporting audit trail.
    const supportingRuns = corroborated
      ? corroborated.runs.filter((run) => run !== result)
      : [];
    // The review may have outlived the lease and been reclaimed by another
    // runner. Completion is fenced: re-lock the claim row inside one
    // transaction and persist nothing if this runner no longer holds it.
    const applied = await db.transaction(async (tx) => {
      const held = await tx
        .select({ id: schema.marketDraftReviewJobs.id })
        .from(schema.marketDraftReviewJobs)
        .where(claimedBy(job, runnerId))
        .for("update");

      if (held.length === 0) {
        return null;
      }

      const { reviewId } = await applyDraftReviewResult(
        {
          draftId: draft.id,
          metadataHash: job.metadataHash,
          result,
          supportingRuns,
        },
        tx,
      );
      await tx
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

      return reviewId;
    });

    if (applied === null) {
      return { draftId: draft.id, jobId: job.id, outcome: "cancelled" };
    }

    return {
      draftId: draft.id,
      jobId: job.id,
      outcome: "succeeded",
      verdict: result.verdict,
    };
  } catch (error) {
    await recordJobFailure(job, runnerId, error);

    return { draftId: job.draftId, jobId: job.id, outcome: "failed" };
  }
}

/** The fencing condition: this job row, still running, still this runner's. */
function claimedBy(job: ClaimedJob, runnerId: string) {
  return and(
    eq(schema.marketDraftReviewJobs.id, job.id),
    eq(schema.marketDraftReviewJobs.status, "running"),
    eq(schema.marketDraftReviewJobs.lockedBy, runnerId),
  );
}

/**
 * Extends the lease before each extra corroboration run — a corroborated
 * review may legitimately outlive one lease window. Zero rows means another
 * runner reclaimed the job; the throw routes into recordJobFailure, whose
 * fenced update then drops this runner's outcome silently.
 */
async function renewDraftReviewJobLease(job: ClaimedJob, runnerId: string) {
  const renewed = await db
    .update(schema.marketDraftReviewJobs)
    .set({
      leaseUntil: new Date(Date.now() + LEASE_MS),
      updatedAt: new Date(),
    })
    .where(claimedBy(job, runnerId))
    .returning({ id: schema.marketDraftReviewJobs.id });

  if (renewed.length === 0) {
    throw new Error(
      `Lost the lease on draft review job ${job.id} mid-corroboration.`,
    );
  }
}

async function recordJobFailure(
  job: ClaimedJob,
  runnerId: string,
  error: unknown,
) {
  // The claim update already counted this attempt into the returned row.
  const attemptCount = job.attemptCount;
  const terminal = attemptCount >= job.maxAttempts;
  const backoffMs = Math.min(
    RETRY_BASE_MS * 2 ** Math.max(attemptCount - 1, 0),
    RETRY_MAX_MS,
  );
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  // Fenced like completion: if another runner reclaimed the job after our
  // lease lapsed, its outcome owns the row and this failure is dropped.
  const [failed] = await db
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
    .where(claimedBy(job, runnerId))
    .returning({ id: schema.marketDraftReviewJobs.id });

  // The creator should not be stuck on a silent terminal failure: surface it
  // as a changes-requested style transition would be dishonest, so release
  // the draft back to editing with no review row.
  if (terminal && failed) {
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
