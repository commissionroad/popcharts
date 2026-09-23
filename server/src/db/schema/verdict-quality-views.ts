import { sql } from "drizzle-orm";
import {
  date,
  doublePrecision,
  integer,
  pgView,
  text,
} from "drizzle-orm/pg-core";

import { aiReviewProvider } from "./market-draft-reviews";
import {
  resolutionCommitState,
  resolutionProvider,
  resolutionVerdict,
} from "./market-resolutions";

/**
 * Read-only quality lenses over the two verdict audit logs (ADR 0027 A4).
 *
 * These answer the drift questions the verdict-quality loop asks of
 * production data — parked/manual-review rate over time, confidence
 * distribution, and per-provider verdict mix — without any pass hand-rolling
 * the aggregate again in a script. They are plain views, not materialized
 * ones: the audit logs are small, staleness would be its own bug class, and
 * a view needs no refresh job.
 *
 * Three conventions hold across all three:
 *
 * - **The clock is the judgment clock, not the chain clock.** Resolution rows
 *   bucket on `created_at`, which is set when the verdict is written.
 *   `resolved_at` is null while a row is `pending` and carries a block
 *   timestamp once confirmed, so bucketing on it would drop exactly the rows
 *   a drift question cares about and date the rest by when a transaction
 *   landed. Draft reviews bucket on `reviewed_at`, which is that side's
 *   judgment clock.
 * - **`commit_state` is exposed, never applied.** ADR 0026's reader rule says
 *   only confirmed rows are real resolutions. A view that silently filtered to
 *   confirmed would hide the pending and superseded populations, which is a
 *   drift signal in its own right; a view that silently included them would
 *   break the rule. Both resolution views keep `commit_state` in the grain so
 *   the reader applies the rule deliberately.
 * - **Rates are computed, counts are raw.** The named rate columns save every
 *   reader the same division; the underlying counts stay so a reader can
 *   re-aggregate across the grain.
 */

/**
 * Daily verdict mix per resolution provider, model, prompt version, and
 * commit state.
 *
 * Answers both "parked/manual-review rate over time" and "per-provider verdict
 * drift": the verdict counts are the mix, and `manual_review_rate` is the
 * parked rate. `avg_confidence` is null for a group whose rows all carry a
 * null confidence — `manual` provider rows always do, since operator overrides
 * have no confidence to report — because `avg()` skips nulls rather than
 * reading them as zero.
 */
export const verdictQualityResolutionDaily = pgView(
  "verdict_quality_resolution_daily",
  {
    day: date("day", { mode: "string" }).notNull(),
    provider: resolutionProvider("provider").notNull(),
    modelId: text("model_id"),
    promptVersion: text("prompt_version").notNull(),
    commitState: resolutionCommitState("commit_state").notNull(),
    runs: integer("runs").notNull(),
    manualReviewRuns: integer("manual_review_runs").notNull(),
    resolveYesRuns: integer("resolve_yes_runs").notNull(),
    resolveNoRuns: integer("resolve_no_runs").notNull(),
    cancelDrawRuns: integer("cancel_draw_runs").notNull(),
    requeueTooEarlyRuns: integer("requeue_too_early_runs").notNull(),
    hardFlaggedRuns: integer("hard_flagged_runs").notNull(),
    manualReviewRate: doublePrecision("manual_review_rate").notNull(),
    avgConfidence: doublePrecision("avg_confidence"),
  },
).as(
  sql`
    select
      date_trunc('day', "created_at")::date as "day",
      "provider",
      "model_id",
      "prompt_version",
      "commit_state",
      count(*)::int as "runs",
      count(*) filter (where "verdict" = 'manual_review')::int as "manual_review_runs",
      count(*) filter (where "verdict" = 'resolve_yes')::int as "resolve_yes_runs",
      count(*) filter (where "verdict" = 'resolve_no')::int as "resolve_no_runs",
      count(*) filter (where "verdict" = 'cancel_draw')::int as "cancel_draw_runs",
      count(*) filter (where "verdict" = 'requeue_too_early')::int as "requeue_too_early_runs",
      count(*) filter (where jsonb_array_length("hard_flags") > 0)::int as "hard_flagged_runs",
      ((count(*) filter (where "verdict" = 'manual_review'))::double precision / count(*)) as "manual_review_rate",
      avg("confidence")::double precision as "avg_confidence"
    from "market_resolutions"
    group by 1, 2, 3, 4, 5
  `,
);

/**
 * Daily verdict mix per draft-review provider, model, and prompt version.
 *
 * The review side has no confidence column — its calibration signal lives in
 * the `scores` jsonb — so this view carries no confidence aggregate and there
 * is no review-side histogram. `hard_flagged_reviews` is the closest
 * review-side analogue of a safety-trip rate.
 */
export const verdictQualityDraftReviewDaily = pgView(
  "verdict_quality_draft_review_daily",
  {
    day: date("day", { mode: "string" }).notNull(),
    provider: aiReviewProvider("provider").notNull(),
    modelId: text("model_id"),
    promptVersion: text("prompt_version").notNull(),
    reviews: integer("reviews").notNull(),
    approveReviews: integer("approve_reviews").notNull(),
    rejectReviews: integer("reject_reviews").notNull(),
    manualReviewReviews: integer("manual_review_reviews").notNull(),
    hardFlaggedReviews: integer("hard_flagged_reviews").notNull(),
    manualReviewRate: doublePrecision("manual_review_rate").notNull(),
  },
).as(
  sql`
    select
      date_trunc('day', "reviewed_at")::date as "day",
      "provider",
      "model_id",
      "prompt_version",
      count(*)::int as "reviews",
      count(*) filter (where "verdict" = 'approve')::int as "approve_reviews",
      count(*) filter (where "verdict" = 'reject')::int as "reject_reviews",
      count(*) filter (where "verdict" = 'manual_review')::int as "manual_review_reviews",
      count(*) filter (where jsonb_array_length("hard_flags") > 0)::int as "hard_flagged_reviews",
      ((count(*) filter (where "verdict" = 'manual_review'))::double precision / count(*)) as "manual_review_rate"
    from "market_draft_reviews"
    group by 1, 2, 3, 4
  `,
);

/**
 * Confidence histogram of resolution verdicts, in ten half-open buckets of
 * width 0.1.
 *
 * `bucket_lower` is the inclusive floor of the bucket, so a row falls in
 * `[bucket_lower, bucket_lower + 0.1)`. A confidence of exactly 1.0 folds into
 * the top bucket (0.9) rather than opening an eleventh one, which is why the
 * bucket index is clamped rather than taken straight from `floor()`.
 *
 * Rows with a null confidence are excluded: they are not low-confidence, they
 * are unmeasured, and a histogram that bucketed them as zero would report the
 * opposite of the truth. Count them from
 * {@link verdictQualityResolutionDaily} instead, where they show up as a group
 * with a null `avg_confidence`.
 *
 * `confidence` is cast to `numeric` before it is scaled, and that cast is
 * load-bearing rather than decorative. The column is `real`, so a stored 0.7
 * is really 0.69999998, and `floor(0.7 * 10)` in float4 is 6 — every
 * confidence that a model reported on a bucket edge would land one bucket too
 * low, silently. Casting to `numeric` first goes through the shortest
 * round-tripping decimal text (`0.7`), so the bucket matches the number the
 * model actually reported.
 */
export const verdictQualityResolutionConfidence = pgView(
  "verdict_quality_resolution_confidence",
  {
    provider: resolutionProvider("provider").notNull(),
    modelId: text("model_id"),
    promptVersion: text("prompt_version").notNull(),
    commitState: resolutionCommitState("commit_state").notNull(),
    verdict: resolutionVerdict("verdict").notNull(),
    bucketLower: doublePrecision("bucket_lower").notNull(),
    runs: integer("runs").notNull(),
  },
).as(
  sql`
    select
      "provider",
      "model_id",
      "prompt_version",
      "commit_state",
      "verdict",
      (least(floor("confidence"::numeric * 10)::int, 9)::double precision / 10) as "bucket_lower",
      count(*)::int as "runs"
    from "market_resolutions"
    where "confidence" is not null
    group by 1, 2, 3, 4, 5, 6
  `,
);

/** Drizzle select shape of a verdict_quality_resolution_daily row. */
export type VerdictQualityResolutionDailyRow =
  typeof verdictQualityResolutionDaily.$inferSelect;

/** Drizzle select shape of a verdict_quality_draft_review_daily row. */
export type VerdictQualityDraftReviewDailyRow =
  typeof verdictQualityDraftReviewDaily.$inferSelect;

/** Drizzle select shape of a verdict_quality_resolution_confidence row. */
export type VerdictQualityResolutionConfidenceRow =
  typeof verdictQualityResolutionConfidence.$inferSelect;
