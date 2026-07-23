/**
 * Queue vocabulary shared by the AI review and AI resolution job tables.
 * The two queues are siblings by design (ADR 0012) and move through the same
 * lifecycle, so the state and trigger sets get one definition here instead of
 * a copy in each table's module. Each table still declares its own Postgres
 * enum type — only the value lists are shared, so the two can be migrated
 * independently if they ever need to diverge.
 *
 * This module declares no table, so it is imported directly rather than
 * re-exported from `./index`, matching `./uint256`.
 */

/**
 * Queue lifecycle of a job. queued/running/retryable_failed are the "active"
 * states that block a duplicate job for the same market metadata.
 */
export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "retryable_failed",
  "terminal_failed",
  "cancelled",
] as const;

/**
 * Who queued the job: the runner's automatic sweep, an operator action, or a
 * retry.
 */
export const JOB_TRIGGERS = ["automatic", "manual", "retry"] as const;
