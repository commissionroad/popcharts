import { db, eq, schema } from "src/db/client";

import type { MarketResolutionJobRow } from "./jobs";

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

export async function markResolutionJobFailure({
  error,
  job,
  now,
  retryBaseMs,
}: {
  error: unknown;
  job: MarketResolutionJobRow;
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
    .update(schema.marketResolutionJobs)
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
    .where(eq(schema.marketResolutionJobs.id, job.id))
    .returning();

  if (!updatedJob) {
    throw new Error(`Failed to mark resolution job ${job.id} failed.`);
  }

  return updatedJob;
}

export async function cancelResolutionJob({
  job,
  now,
  reason,
}: {
  job: MarketResolutionJobRow;
  now: Date;
  reason: string;
}) {
  const [updatedJob] = await db
    .update(schema.marketResolutionJobs)
    .set({
      completedAt: now,
      lastError: reason,
      leaseUntil: null,
      lockedBy: null,
      status: "cancelled",
      updatedAt: now,
    })
    .where(eq(schema.marketResolutionJobs.id, job.id))
    .returning();

  if (!updatedJob) {
    throw new Error(`Failed to cancel resolution job ${job.id}.`);
  }

  return updatedJob;
}

/**
 * Returns a claimed job to the queue with a future run_after, without counting
 * a failure. Used when the model says `too_early`, or when a NO decision arrives
 * before its on-chain deadline — the market is fine, it simply is not time yet.
 */
export async function requeueResolutionJob({
  job,
  now,
  reason,
  runAfter,
}: {
  job: MarketResolutionJobRow;
  now: Date;
  reason: string;
  runAfter: Date;
}) {
  const [updatedJob] = await db
    .update(schema.marketResolutionJobs)
    .set({
      lastError: reason,
      leaseUntil: null,
      lockedBy: null,
      runAfter,
      status: "queued",
      updatedAt: now,
    })
    .where(eq(schema.marketResolutionJobs.id, job.id))
    .returning();

  if (!updatedJob) {
    throw new Error(`Failed to requeue resolution job ${job.id}.`);
  }

  return updatedJob;
}
