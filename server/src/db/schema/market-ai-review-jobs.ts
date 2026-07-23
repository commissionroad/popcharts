import { sql } from "drizzle-orm";
import {
  bigint,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { JOB_STATUSES, JOB_TRIGGERS } from "./job-queue";
import { aiReviewProvider, marketAiReviews } from "./market-ai-reviews";
import { marketMetadata } from "./market-metadata";
import { markets } from "./markets";

/** Postgres enum for a review job's queue state, derived from the shared array. */
export const aiReviewJobStatus = pgEnum("ai_review_job_status", [
  ...JOB_STATUSES,
]);

/** Postgres enum for a review job's trigger, derived from the shared array. */
export const aiReviewJobTrigger = pgEnum("ai_review_job_trigger", [
  ...JOB_TRIGGERS,
]);

// Mutable queue state for AI review work. The durable review output itself
// lives in market_ai_reviews; this table tracks scheduling, leases, retries,
// and the optional pointer to the review row that completed the job.
export const marketAiReviewJobs = pgTable(
  "market_ai_review_jobs",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    marketId: bigint("market_id", { mode: "bigint" }).notNull(),
    metadataHash: varchar("metadata_hash", { length: 66 }).notNull(),
    status: aiReviewJobStatus("status").default("queued").notNull(),
    trigger: aiReviewJobTrigger("trigger").default("automatic").notNull(),
    requestedProvider: aiReviewProvider("requested_provider"),
    requestedModel: text("requested_model"),
    priority: integer("priority").default(0).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(5).notNull(),
    runAfter: timestamp("run_after").defaultNow().notNull(),
    leaseUntil: timestamp("lease_until"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    reviewId: integer("review_id").references(() => marketAiReviews.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.chainId, table.marketId, table.metadataHash],
      foreignColumns: [markets.chainId, markets.marketId, markets.metadataHash],
      name: "market_ai_review_jobs_market_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      columns: [table.chainId, table.metadataHash],
      foreignColumns: [marketMetadata.chainId, marketMetadata.metadataHash],
      name: "market_ai_review_jobs_metadata_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    index("market_ai_review_jobs_status_run_after_idx").on(
      table.status,
      table.runAfter,
    ),
    index("market_ai_review_jobs_market_idx").on(
      table.chainId,
      table.marketId,
      table.metadataHash,
    ),
    // Prevent duplicate active jobs for the same market metadata version while
    // still allowing historical succeeded/failed/cancelled jobs to remain.
    uniqueIndex("market_ai_review_jobs_active_unique_idx")
      .on(table.chainId, table.marketId, table.metadataHash)
      .where(sql`${table.status} in ('queued', 'running', 'retryable_failed')`),
  ],
);
