import {
  bigint,
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

export const aiReviewProvider = pgEnum("ai_review_provider", [
  "anthropic",
  "heuristic",
  "ollama",
]);

export const aiReviewVerdict = pgEnum("ai_review_verdict", [
  "approve",
  "reject",
  "manual_review",
]);

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
