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
    category: varchar("category", { length: 40 }).notNull(),
    resolutionCriteria: text("resolution_criteria").notNull(),
    resolutionSources: jsonb("resolution_sources")
      .$type<string[]>()
      .default([])
      .notNull(),
    resolutionUrl: text("resolution_url"),
    // Temporal validity guardrails (AI resolution, ADR 0012). The NO/draw gate
    // — the earliest a NO or draw can be certain — is the existing on-chain
    // markets.resolution_time; these columns add the rest of the per-market
    // resolution window and are all nullable so the migration is additive.
    //   - yesNotBefore: earliest a YES may resolve. Null defaults to the NO gate
    //     (markets.resolution_time); set earlier only for open-ended markets
    //     ("Will X happen in 2026?") that admit an early YES.
    //   - observationWindow*: the span during which an event "counts", passed to
    //     the resolver model as evidence-scoping guidance (not a hard gate).
    yesNotBefore: timestamp("yes_not_before"),
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
