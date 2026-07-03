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

import type {
  EvidenceItem,
  ReviewScores,
  SourceCheck,
} from "src/ai-review/types";
import { marketMetadata } from "./market-metadata";
import { markets } from "./markets";

/** Postgres enum mirroring ReviewProviderName from src/ai-review/types. */
export const aiReviewProvider = pgEnum("ai_review_provider", [
  "anthropic",
  "heuristic",
  "ollama",
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
