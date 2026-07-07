import { and, eq, isNull, lte, or, schema, sql } from "src/db/client";

export function claimableReviewJobCondition(now: Date) {
  return and(
    or(
      eq(schema.marketAiReviewJobs.status, "queued"),
      eq(schema.marketAiReviewJobs.status, "retryable_failed"),
      eq(schema.marketAiReviewJobs.status, "running"),
    ),
    lte(schema.marketAiReviewJobs.runAfter, now),
    // Running jobs become claimable only after their lease expires, which is how
    // another runner recovers work from a crashed process.
    or(
      isNull(schema.marketAiReviewJobs.leaseUntil),
      lte(schema.marketAiReviewJobs.leaseUntil, now),
    ),
  );
}

export function noActiveReviewJobForCurrentMarket() {
  return sql`not exists (
    select 1
    from ${schema.marketAiReviewJobs}
    where ${schema.marketAiReviewJobs.chainId} = ${schema.markets.chainId}
      and ${schema.marketAiReviewJobs.marketId} = ${schema.markets.marketId}
      and ${schema.marketAiReviewJobs.metadataHash} = ${schema.markets.metadataHash}
      and ${schema.marketAiReviewJobs.status} in ('queued', 'running', 'retryable_failed')
  )`;
}

export function noAiReviewForCurrentMarket() {
  return sql`not exists (
    select 1
    from ${schema.marketAiReviews}
    where ${schema.marketAiReviews.chainId} = ${schema.markets.chainId}
      and ${schema.marketAiReviews.marketId} = ${schema.markets.marketId}
      and ${schema.marketAiReviews.metadataHash} = ${schema.markets.metadataHash}
  )`;
}
