import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * The `category` column's varchar bound, exported so the indexer's event
 * parser can enforce it before the insert. The parser rejecting everything
 * the table would reject is what lets it treat any insert failure as
 * transient and parkable rather than a poison log.
 */
export const MARKET_METADATA_CATEGORY_MAX_CHARS = 40;

/**
 * Off-chain market text (question, description, resolution criteria/sources)
 * keyed by (chainId, metadataHash) — the content addressed by the hash the
 * market commits to on-chain. This is what AI review actually judges.
 */
export const marketMetadata = pgTable(
  "market_metadata",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    metadataHash: varchar("metadata_hash", { length: 66 }).notNull(),
    question: text("question").notNull(),
    description: text("description").notNull(),
    category: varchar("category", {
      length: MARKET_METADATA_CATEGORY_MAX_CHARS,
    }).notNull(),
    resolutionCriteria: text("resolution_criteria").notNull(),
    resolutionSources: jsonb("resolution_sources")
      .$type<string[]>()
      .default([])
      .notNull(),
    resolutionUrl: text("resolution_url"),
    // Observation window (AI resolution, ADR 0012): the span during which an
    // event "counts", read by the resolver model as evidence-scoping guidance —
    // not a hard gate. Part of the content-addressed metadata payload (v2), so
    // it is hash-committed and AI-validated. Nullable/optional.
    // (The enforced resolution gates live on-chain: no_not_before is
    // markets.resolution_time and yes_not_before is markets.yes_not_before.)
    observationWindowStart: timestamp("observation_window_start"),
    observationWindowEnd: timestamp("observation_window_end"),
    outcomeYes: text("outcome_yes"),
    outcomeNo: text("outcome_no"),
    metadataCreatedAt: text("metadata_created_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("market_metadata_chain_hash_idx").on(
      table.chainId,
      table.metadataHash,
    ),
  ],
);
