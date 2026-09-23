CREATE VIEW "public"."verdict_quality_draft_review_daily" AS (
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
  );--> statement-breakpoint
CREATE VIEW "public"."verdict_quality_resolution_confidence" AS (
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
  );--> statement-breakpoint
CREATE VIEW "public"."verdict_quality_resolution_daily" AS (
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
  );