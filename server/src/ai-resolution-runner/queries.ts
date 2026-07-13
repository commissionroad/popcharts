import { and, eq, isNull, lte, or, schema, sql } from "src/db/client";

export function claimableResolutionJobCondition(now: Date) {
  return and(
    or(
      eq(schema.marketResolutionJobs.status, "queued"),
      eq(schema.marketResolutionJobs.status, "retryable_failed"),
      eq(schema.marketResolutionJobs.status, "running"),
    ),
    lte(schema.marketResolutionJobs.runAfter, now),
    // The hard floor: a job is never claimed before the market's earliest
    // legitimate resolution time, independent of the mutable run_after knob.
    lte(schema.marketResolutionJobs.notBefore, now),
    // Running jobs become claimable only after their lease expires, which is how
    // another runner recovers work from a crashed process.
    or(
      isNull(schema.marketResolutionJobs.leaseUntil),
      lte(schema.marketResolutionJobs.leaseUntil, now),
    ),
  );
}

export function noActiveResolutionJobForCurrentMarket() {
  return sql`not exists (
    select 1
    from ${schema.marketResolutionJobs}
    where ${schema.marketResolutionJobs.chainId} = ${schema.markets.chainId}
      and ${schema.marketResolutionJobs.marketId} = ${schema.markets.marketId}
      and ${schema.marketResolutionJobs.metadataHash} = ${schema.markets.metadataHash}
      and ${schema.marketResolutionJobs.status} in ('queued', 'running', 'retryable_failed')
  )`;
}

export function noResolutionForCurrentMarket() {
  return sql`not exists (
    select 1
    from ${schema.marketResolutions}
    where ${schema.marketResolutions.chainId} = ${schema.markets.chainId}
      and ${schema.marketResolutions.marketId} = ${schema.markets.marketId}
      and ${schema.marketResolutions.metadataHash} = ${schema.markets.metadataHash}
  )`;
}
