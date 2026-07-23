import {
  bigint,
  foreignKey,
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

import {
  REVIEW_PROVIDER_NAMES,
  type EvidenceItem,
  type ReviewScoreRationales,
  type ReviewScores,
  type SourceCheck,
} from "src/ai-review/types";
import { marketMetadata } from "./market-metadata";
import { markets } from "./markets";

/**
 * Postgres enum for ReviewProviderName, derived from the same const array so
 * adding a provider surfaces here as a drizzle schema diff (migration needed)
 * instead of an enum-insert error at runtime.
 */
export const aiReviewProvider = pgEnum("ai_review_provider", [
  ...REVIEW_PROVIDER_NAMES,
]);

/** Postgres enum mirroring ReviewVerdict from src/ai-review/types. */
export const aiReviewVerdict = pgEnum("ai_review_verdict", [
  "approve",
  "reject",
  "manual_review",
]);

/**
 * Append-only audit log of completed AI reviews, keyed to the exact market
 * metadata hash that was judged. Rows are never updated; a re-review of new
 * metadata adds a new row, so every stored verdict stays reproducible.
 */
export const marketAiReviews = pgTable(
  "market_ai_reviews",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    marketId: bigint("market_id", { mode: "bigint" }).notNull(),
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
      .default({
        contentSafety: "No rationale was stored for this historical review.",
        corroboration: "No rationale was stored for this historical review.",
        disputeRisk: "No rationale was stored for this historical review.",
        objectivity: "No rationale was stored for this historical review.",
        promptInjectionRisk:
          "No rationale was stored for this historical review.",
        publicKnowability:
          "No rationale was stored for this historical review.",
        sourceQuality: "No rationale was stored for this historical review.",
      })
      .notNull(),
    sourceChecks: jsonb("source_checks").$type<SourceCheck[]>().notNull(),
    evidence: jsonb("evidence").$type<EvidenceItem[]>().notNull(),
    reviewedAt: timestamp("reviewed_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.chainId, table.marketId, table.metadataHash],
      foreignColumns: [markets.chainId, markets.marketId, markets.metadataHash],
      name: "market_ai_reviews_market_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      columns: [table.chainId, table.metadataHash],
      foreignColumns: [marketMetadata.chainId, marketMetadata.metadataHash],
      name: "market_ai_reviews_metadata_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    index("market_ai_reviews_market_latest_idx").on(
      table.chainId,
      table.marketId,
      table.reviewedAt,
    ),
    index("market_ai_reviews_metadata_hash_idx").on(
      table.chainId,
      table.metadataHash,
    ),
  ],
);
