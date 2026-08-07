import { sql } from "drizzle-orm";
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
  uniqueIndex,
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
 * Postgres enum for how far a resolution row has got, per ADR 0026. The runner
 * writes its judgment `pending` before submitting `proposeResolution`, so the
 * reasoning survives a crash between the two writes; the indexer settles the
 * row from the `ResolutionProposed` event — `confirmed` when the proposed side
 * matches the row's verdict, `superseded` when it does not (another actor's
 * proposal won; the judgment is preserved, truthfully never acted on).
 *
 * Deliberately no `abandoned` value. A terminal state for rows whose
 * transaction never landed AND whose market never got any proposal is
 * specified but not built — such a row keeps its market re-enqueueable and is
 * listed by the operator lens, so nothing would write it today. Add it with
 * `ALTER TYPE ... ADD VALUE` if ADR 0026's Phase 6 ever happens.
 */
export const resolutionCommitState = pgEnum("resolution_commit_state", [
  "pending",
  "confirmed",
  "superseded",
]);

/**
 * Audit log of resolution determinations, keyed to the market metadata hash
 * that was judged. Every stored verdict — model, heuristic, or manual — stays
 * reproducible. Sibling of market_ai_reviews (ADR 0012).
 *
 * Append-only in its judgment: `verdict`, `outcome`, `reasons`, `evidence`, and
 * the rest are written once and never rewritten. `commit_state` is the one
 * mutable column, and it moves once, forward (ADR 0026). Because of it, **a row
 * existing no longer means the resolution happened on-chain** — read
 * `commit_state` before treating a row as fact.
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
    // Defaults to `confirmed` so every existing row, and every writer that is
    // not the runner's propose path (manual override, creator self-resolve),
    // keeps its current meaning without a data migration.
    commitState: resolutionCommitState("commit_state")
      .default("confirmed")
      .notNull(),
    // Null while `pending`: the block timestamp does not exist until the
    // proposal lands, and inventing one is the inference the money paper-trail
    // invariant forbids. Set by the indexer from the confirming event.
    resolvedAt: timestamp("resolved_at"),
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
    // At most one unconfirmed row per market metadata version, so a retry
    // adopts the pending row its earlier attempt wrote instead of fanning out
    // duplicates. Mirrors the active-job index on market_resolution_jobs.
    // Confirmed rows are deliberately unconstrained: manual override and
    // creator self-resolve can legitimately add to the history.
    uniqueIndex("market_resolutions_pending_unique_idx")
      .on(table.chainId, table.marketId, table.metadataHash)
      .where(sql`${table.commitState} = 'pending'`),
  ],
);
