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
import { marketMetadata } from "./market-metadata";
import { marketResolutions, resolutionProvider } from "./market-resolutions";
import { markets } from "./markets";

/**
 * Postgres enum for a resolution job's queue state, derived from the shared
 * array — the same value list as ai_review_job_status (ADR 0012).
 */
export const resolutionJobStatus = pgEnum("resolution_job_status", [
  ...JOB_STATUSES,
]);

/**
 * Postgres enum for a resolution job's trigger, derived from the shared
 * array — the same value list as ai_review_job_trigger.
 */
export const resolutionJobTrigger = pgEnum("resolution_job_trigger", [
  ...JOB_TRIGGERS,
]);

// Mutable queue state for resolution work. The durable resolution output lives
// in market_resolutions; this table tracks scheduling, leases, retries, and the
// optional pointer to the resolution row that completed the job.
//
// Two distinct time controls (see the temporal validity guardrails, ADR 0012):
//   - notBefore: the hard floor — the market's earliest legitimate resolution
//     time (yesNotBefore). A job is never claimable before it.
//   - runAfter: the mutable scheduling knob — retry backoff, the operator delay
//     window, and too_early re-queues all bump this.
export const marketResolutionJobs = pgTable(
  "market_resolution_jobs",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    marketId: bigint("market_id", { mode: "bigint" }).notNull(),
    metadataHash: varchar("metadata_hash", { length: 66 }).notNull(),
    status: resolutionJobStatus("status").default("queued").notNull(),
    trigger: resolutionJobTrigger("trigger").default("automatic").notNull(),
    requestedProvider: resolutionProvider("requested_provider"),
    requestedModel: text("requested_model"),
    priority: integer("priority").default(0).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(5).notNull(),
    // The earliest legitimate resolution time; never claimed before it.
    notBefore: timestamp("not_before").defaultNow().notNull(),
    runAfter: timestamp("run_after").defaultNow().notNull(),
    leaseUntil: timestamp("lease_until"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    resolutionId: integer("resolution_id").references(
      () => marketResolutions.id,
      {
        onDelete: "restrict",
        onUpdate: "cascade",
      },
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.chainId, table.marketId, table.metadataHash],
      foreignColumns: [markets.chainId, markets.marketId, markets.metadataHash],
      name: "market_resolution_jobs_market_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      columns: [table.chainId, table.metadataHash],
      foreignColumns: [marketMetadata.chainId, marketMetadata.metadataHash],
      name: "market_resolution_jobs_metadata_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    index("market_resolution_jobs_status_run_after_idx").on(
      table.status,
      table.runAfter,
    ),
    index("market_resolution_jobs_market_idx").on(
      table.chainId,
      table.marketId,
      table.metadataHash,
    ),
    // Prevent duplicate active jobs for the same market metadata version while
    // still allowing historical succeeded/failed/cancelled jobs to remain.
    uniqueIndex("market_resolution_jobs_active_unique_idx")
      .on(table.chainId, table.marketId, table.metadataHash)
      .where(sql`${table.status} in ('queued', 'running', 'retryable_failed')`),
  ],
);
