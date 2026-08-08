import { and, inArray, isNull, lte, or, schema, sql } from "src/db/client";

/**
 * Job statuses that count as "someone is still working this market": claimable
 * or actively leased. Both the claim condition and the enqueue guard below must
 * agree on this set — a status in one but not the other either starves a job
 * forever or double-enqueues its market.
 */
const ACTIVE_RESOLUTION_JOB_STATUSES = [
  "queued",
  "running",
  "retryable_failed",
] as const;

/**
 * The claim predicate: an active-status job whose scheduling knob (`run_after`),
 * hard floor (`not_before`), and lease have all cleared. Running jobs become
 * claimable only after their lease expires — that is how another runner
 * recovers work from a crashed process.
 */
export function claimableResolutionJobCondition(now: Date) {
  return and(
    inArray(schema.marketResolutionJobs.status, [
      ...ACTIVE_RESOLUTION_JOB_STATUSES,
    ]),
    lte(schema.marketResolutionJobs.runAfter, now),
    // The hard floor: a job is never claimed before the market's earliest
    // legitimate resolution time, independent of the mutable run_after knob.
    lte(schema.marketResolutionJobs.notBefore, now),
    or(
      isNull(schema.marketResolutionJobs.leaseUntil),
      lte(schema.marketResolutionJobs.leaseUntil, now),
    ),
  );
}

/**
 * Excludes markets that already have an active job, so enqueue never creates a
 * competitor for a job something is still working (correlated with the outer
 * `markets` row, hence raw SQL).
 */
export function noActiveResolutionJobForCurrentMarket() {
  return sql`not exists (
    select 1
    from ${schema.marketResolutionJobs}
    where ${schema.marketResolutionJobs.chainId} = ${schema.markets.chainId}
      and ${schema.marketResolutionJobs.marketId} = ${schema.markets.marketId}
      and ${schema.marketResolutionJobs.metadataHash} = ${schema.markets.metadataHash}
      and ${schema.marketResolutionJobs.status} in ${sql.raw(
        `('${ACTIVE_RESOLUTION_JOB_STATUSES.join("','")}')`,
      )}
  )`;
}

/**
 * Excludes markets whose resolution is already recorded and confirmed on-chain.
 *
 * `commit_state = 'confirmed'` is load-bearing, not a tidy-up (ADR 0026). The
 * runner writes its judgment `pending` *before* proposing, so an unqualified
 * existence check would read that row as "already resolved" and drop the market
 * out of enqueue — permanently, since nothing else would ever pick it up. A
 * `pending` row must stay invisible here so a proposal that never landed gets
 * retried.
 */
export function noResolutionForCurrentMarket() {
  return sql`not exists (
    select 1
    from ${schema.marketResolutions}
    where ${schema.marketResolutions.chainId} = ${schema.markets.chainId}
      and ${schema.marketResolutions.marketId} = ${schema.markets.marketId}
      and ${schema.marketResolutions.metadataHash} = ${schema.markets.metadataHash}
      and ${schema.marketResolutions.commitState} = 'confirmed'
  )`;
}
