import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Lifecycle of an off-chain market draft (ADR 0022). `changes_requested` is
 * the draft projection of a `manual_review` verdict: the reviewer found
 * quality issues the creator can fix, distinct from a policy `rejected`.
 * Both are editable; editing returns the draft to `editing`.
 */
export const MARKET_DRAFT_STATUSES = [
  "editing",
  "in_review",
  "changes_requested",
  "rejected",
  "approved",
  "published",
] as const;

/** One of {@link MARKET_DRAFT_STATUSES}. */
export type MarketDraftStatus = (typeof MARKET_DRAFT_STATUSES)[number];

/** Postgres enum for a draft's lifecycle state, derived from the shared array. */
export const marketDraftStatus = pgEnum("market_draft_status", [
  ...MARKET_DRAFT_STATUSES,
]);

/**
 * Who can see a draft. Only `private` is served today; the column exists so
 * template sharing (ADR 0022, deferred) is a value change, not a migration.
 */
export const MARKET_DRAFT_VISIBILITIES = ["private"] as const;

/** One of {@link MARKET_DRAFT_VISIBILITIES}. */
export type MarketDraftVisibility = (typeof MARKET_DRAFT_VISIBILITIES)[number];

/** Postgres enum for a draft's visibility, derived from the shared array. */
export const marketDraftVisibility = pgEnum("market_draft_visibility", [
  ...MARKET_DRAFT_VISIBILITIES,
]);

/**
 * An off-chain, editable market question (ADR 0022). Content mirrors the
 * create-market params except deadlines, which are stored as relative
 * durations and resolved to absolute timestamps only at publish time — a
 * lingering approved draft stays publishable because its windows are measured
 * from publish, not from approval. Drafts are scoped to their owner and
 * soft-deleted, never destroyed.
 */
export const marketDrafts = pgTable(
  "market_drafts",
  {
    id: serial("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    intendedCreatorAddress: varchar("intended_creator_address", { length: 42 }),

    // Content, mirroring the create form.
    question: text("question").default("").notNull(),
    description: text("description").default("").notNull(),
    category: varchar("category", { length: 40 }).default("Crypto").notNull(),
    outcomeYes: text("outcome_yes").default("").notNull(),
    outcomeNo: text("outcome_no").default("").notNull(),
    resolutionCriteria: text("resolution_criteria").default("").notNull(),
    // Raw form text (one source per line / comma-separated), parsed only when
    // metadata is built, so the editor round-trips exactly what was typed.
    resolutionSources: text("resolution_sources").default("").notNull(),
    resolutionUrl: text("resolution_url").default("").notNull(),
    openingProbability: integer("opening_probability").default(50).notNull(),
    liquidityParameter: integer("liquidity_parameter").default(5000).notNull(),
    // Relative deadline windows (seconds from publish), per ADR 0022 §4.
    graduationWindowSeconds: integer("graduation_window_seconds")
      .default(60 * 60)
      .notNull(),
    resolutionWindowSeconds: integer("resolution_window_seconds")
      .default(7 * 24 * 60 * 60)
      .notNull(),

    // Bookkeeping.
    status: marketDraftStatus("status").default("editing").notNull(),
    isTemplate: boolean("is_template").default(false).notNull(),
    visibility: marketDraftVisibility("visibility")
      .default("private")
      .notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    // Content hash snapshotted at submit; publish re-checks the draft is
    // unchanged against it, and reviews are keyed to it.
    submittedMetadataHash: varchar("submitted_metadata_hash", { length: 66 }),
    publishedChainId: integer("published_chain_id"),
    publishedMarketId: bigint("published_market_id", { mode: "bigint" }),
    publishedTransactionHash: varchar("published_transaction_hash", {
      length: 66,
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    submittedAt: timestamp("submitted_at"),
    reviewedAt: timestamp("reviewed_at"),
    publishedAt: timestamp("published_at"),
  },
  (table) => [
    index("market_drafts_owner_idx").on(
      table.ownerUserId,
      table.deleted,
      table.updatedAt,
    ),
    index("market_drafts_status_idx").on(table.status),
  ],
);

/** Drizzle select shape of a market_drafts row. */
export type MarketDraftRow = typeof marketDrafts.$inferSelect;
