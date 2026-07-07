import { db, eq, schema } from "src/db/client";
import type { MarketAiReviewJobRow } from "./jobs";

const MAX_RETRY_DELAY_MS = 30 * 60 * 1000;
const MAX_ERROR_LENGTH = 800;

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

export async function markReviewJobFailure({
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

export async function cancelReviewJob({
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
