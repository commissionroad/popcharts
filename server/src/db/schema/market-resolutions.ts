import {
  bigint,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import type { EvidenceItem, SourceCheck } from "src/ai-review/types";
import {
  RESOLUTION_OUTCOMES,
  RESOLUTION_PROVIDER_NAMES,
  RESOLUTION_VERDICTS,
} from "src/ai-resolution/types";
import { marketMetadata } from "./market-metadata";
import { markets } from "./markets";

/**
 * Postgres enum for ResolutionProviderName, derived from the same const array
 * so adding a provider surfaces here as a drizzle schema diff (migration
 * needed) instead of an enum-insert error at runtime. Includes `manual` for
 * operator override / trusted-creator self-resolve rows, which is why this is
 * a distinct enum rather than a reuse of ai_review_provider.
 */
export const resolutionProvider = pgEnum("resolution_provider", [
  ...RESOLUTION_PROVIDER_NAMES,
]);

/** Postgres enum for ResolutionOutcome, derived from the same const array. */
export const resolutionOutcome = pgEnum("resolution_outcome", [
  ...RESOLUTION_OUTCOMES,
]);

/** Postgres enum for ResolutionVerdict, derived from the same const array. */
export const resolutionVerdict = pgEnum("resolution_verdict", [
  ...RESOLUTION_VERDICTS,
]);

/**
 * Append-only audit log of resolution determinations, keyed to the market
 * metadata hash that was judged. Rows are never updated, so every stored
 * verdict — model, heuristic, or manual — stays reproducible. Sibling of
 * market_ai_reviews (ADR 0012).
 */
export const marketResolutions = pgTable(
  "market_resolutions",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    marketId: bigint("market_id", { mode: "bigint" }).notNull(),
    metadataHash: varchar("metadata_hash", { length: 66 }).notNull(),
    // The child CompleteSetBinaryMarket contract this resolution targets.
    postgradMarketAddress: varchar("postgrad_market_address", { length: 42 }),
    provider: resolutionProvider("provider").notNull(),
    modelId: text("model_id"),
    promptVersion: text("prompt_version").notNull(),
    outcome: resolutionOutcome("outcome").notNull(),
    verdict: resolutionVerdict("verdict").notNull(),
    // 0..1; null for `manual` provider rows where confidence is not applicable.
    confidence: real("confidence"),
    reasons: jsonb("reasons").$type<string[]>().notNull(),
    evidence: jsonb("evidence").$type<EvidenceItem[]>().notNull(),
    sourceChecks: jsonb("source_checks").$type<SourceCheck[]>().notNull(),
    hardFlags: jsonb("hard_flags").$type<string[]>().notNull(),
    resolvedAt: timestamp("resolved_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.chainId, table.marketId, table.metadataHash],
      foreignColumns: [markets.chainId, markets.marketId, markets.metadataHash],
      name: "market_resolutions_market_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      columns: [table.chainId, table.metadataHash],
      foreignColumns: [marketMetadata.chainId, marketMetadata.metadataHash],
      name: "market_resolutions_metadata_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    index("market_resolutions_market_latest_idx").on(
      table.chainId,
      table.marketId,
      table.resolvedAt,
    ),
    index("market_resolutions_metadata_hash_idx").on(
      table.chainId,
      table.metadataHash,
    ),
  ],
);
