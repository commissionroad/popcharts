import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import type {
  EvidenceItem,
  ReviewScoreRationales,
  ReviewScores,
  SourceCheck,
} from "src/ai-review/types";
import { REVIEW_PROVIDER_NAMES, REVIEW_VERDICTS } from "src/ai-review/types";
import { JOB_STATUSES, JOB_TRIGGERS } from "./job-queue";
import { marketDrafts } from "./market-drafts";

// The four review pg enums moved here from the retired market_ai_reviews /
// market_ai_review_jobs schema files (ADR 0022 P5 follow-up): the DRAFT
// review tables were always their surviving consumer, and the Postgres enum
// types themselves are unchanged — same names, same members — so relocating
// the definitions is invisible to the database.

/**
 * Postgres enum for ReviewProviderName, derived from the same const array so
 * adding a provider surfaces here as a drizzle schema diff (migration needed)
 * instead of an enum-insert error at runtime.
 */
export const aiReviewProvider = pgEnum("ai_review_provider", [
  ...REVIEW_PROVIDER_NAMES,
]);

/** Postgres enum for ReviewVerdict, derived from the same const array. */
export const aiReviewVerdict = pgEnum("ai_review_verdict", [
  ...REVIEW_VERDICTS,
]);

/** Postgres enum for a review job's queue state, derived from the shared array. */
export const aiReviewJobStatus = pgEnum("ai_review_job_status", [
  ...JOB_STATUSES,
]);

/** Postgres enum for a review job's trigger, derived from the shared array. */
export const aiReviewJobTrigger = pgEnum("ai_review_job_trigger", [
  ...JOB_TRIGGERS,
]);

/**
 * How severe a single feedback item is for the creator: a `blocker` must be
 * fixed before the draft can pass review, a `warning` likely needs attention,
 * an `info` is advice.
 */
export const DRAFT_FEEDBACK_SEVERITIES = [
  "blocker",
  "warning",
  "info",
] as const;

/** One of {@link DRAFT_FEEDBACK_SEVERITIES}. */
export type DraftFeedbackSeverity = (typeof DRAFT_FEEDBACK_SEVERITIES)[number];

/**
 * One actionable piece of review feedback shown to the creator: what the
 * issue is and how to fix it, tied to the form field it concerns when one
 * applies.
 */
export type DraftFeedbackItem = {
  field?:
    "question" | "description" | "resolutionCriteria" | "resolutionSources";
  howToFix: string;
  issue: string;
  severity: DraftFeedbackSeverity;
  title: string;
};

/**
 * The creator-facing translation of a ReviewResult: a one-line summary plus
 * actionable items. Stored alongside the raw review output so the UI never
 * re-derives copy from reviewer internals.
 */
export type DraftReviewFeedback = {
  items: DraftFeedbackItem[];
  summary: string;
};

/**
 * Append-only audit log of completed draft reviews (ADR 0022 "draft review
 * data model"): the market-review pattern keyed to a draft content snapshot
 * instead of an on-chain market. Rows are never updated; an edit produces a
 * new metadata hash and a fresh review row.
 */
export const marketDraftReviews = pgTable(
  "market_draft_reviews",
  {
    id: serial("id").primaryKey(),
    draftId: integer("draft_id")
      .references(() => marketDrafts.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      })
      .notNull(),
    metadataHash: varchar("metadata_hash", { length: 66 }).notNull(),
    provider: aiReviewProvider("provider").notNull(),
    modelId: text("model_id"),
    promptVersion: text("prompt_version").notNull(),
    verdict: aiReviewVerdict("verdict").notNull(),
    scores: jsonb("scores").$type<ReviewScores>().notNull(),
    hardFlags: jsonb("hard_flags").$type<string[]>().notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull(),
    scoreRationales: jsonb("score_rationales")
      .$type<ReviewScoreRationales>()
      .notNull(),
    sourceChecks: jsonb("source_checks").$type<SourceCheck[]>().notNull(),
    evidence: jsonb("evidence").$type<EvidenceItem[]>().notNull(),
    feedback: jsonb("feedback").$type<DraftReviewFeedback>().notNull(),
    reviewedAt: timestamp("reviewed_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("market_draft_reviews_draft_latest_idx").on(
      table.draftId,
      table.reviewedAt,
    ),
  ],
);

/** Drizzle select shape of a market_draft_reviews row. */
export type MarketDraftReviewRow = typeof marketDraftReviews.$inferSelect;

/**
 * Mutable queue state for draft review work, mirroring market_ai_review_jobs
 * with the on-chain-market key replaced by the draft key. The durable review
 * output lives in market_draft_reviews.
 */
export const marketDraftReviewJobs = pgTable(
  "market_draft_review_jobs",
  {
    id: serial("id").primaryKey(),
    draftId: integer("draft_id")
      .references(() => marketDrafts.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      })
      .notNull(),
    metadataHash: varchar("metadata_hash", { length: 66 }).notNull(),
    status: aiReviewJobStatus("status").default("queued").notNull(),
    trigger: aiReviewJobTrigger("trigger").default("automatic").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(5).notNull(),
    runAfter: timestamp("run_after").defaultNow().notNull(),
    leaseUntil: timestamp("lease_until"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    reviewId: integer("review_id").references(() => marketDraftReviews.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("market_draft_review_jobs_status_run_after_idx").on(
      table.status,
      table.runAfter,
    ),
    index("market_draft_review_jobs_draft_idx").on(table.draftId),
  ],
);

/** Drizzle select shape of a market_draft_review_jobs row. */
export type MarketDraftReviewJobRow = typeof marketDraftReviewJobs.$inferSelect;
