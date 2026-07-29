import {
  boolean,
  bigint,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { contracts } from "./contracts";
import { uint256 } from "./uint256";

/**
 * Lifecycle of a market as tracked off-chain: AI review gates under_review
 * into bootstrap (or rejected), and the chain watchers drive the
 * graduating/graduated/resolved/refunded transitions — including the
 * resolution_pending/disputed pair a graduated market passes through while
 * its dispute window is open (repo ADR 0024).
 *
 * Single definition of the status set — the Postgres enum, the `MarketStatus`
 * union, and the API's `MarketStatusSchema` all derive from this array. It
 * lives here rather than in `src/api/models/markets` because the persistence
 * layer never imports the API layer. Order is part of the stored enum:
 * appending is free, reordering or removing needs a migration.
 *
 * Not to be confused with `@popcharts/protocol`'s `MARKET_STATUS`, which is
 * the on-chain MarketTypes.MarketStatus encoding and a different set.
 */
export const MARKET_STATUSES = [
  "under_review",
  "bootstrap",
  "graduating",
  "graduated",
  "resolved",
  "refunded",
  "cancelled",
  "rejected",
  // Appended out of lifecycle order on purpose: these two sit between
  // `graduated` and `resolved` in the dispute-window flow (repo ADR 0024), but
  // the array order is the stored Postgres enum order, so inserting them where
  // they belong would rewrite the type. The Solidity MarketStatus enum appends
  // for the same reason.
  "resolution_pending",
  "disputed",
] as const;

/** One of {@link MARKET_STATUSES}. */
export type MarketStatus = (typeof MARKET_STATUSES)[number];

/** Postgres enum for MarketStatus, derived from the same const array. */
export const marketStatus = pgEnum("market_status", [...MARKET_STATUSES]);

/**
 * The lifecycle facts the rest of the codebase actually branches on. Recorded
 * once per status here rather than re-derived from `status === "graduated"`
 * comparisons scattered across services, the indexer, the keeper and the app.
 *
 * The table, more than the predicates below it, is the point: `satisfies
 * Record<MarketStatus, …>` makes appending to {@link MARKET_STATUSES} without
 * answering these questions a compile error. The dispute-window append
 * (`resolution_pending`/`disputed`) is the cautionary case — TypeScript forced
 * the two exhaustive `Record<MarketStatus, string>` label maps in the app to
 * widen, and every *boolean* gate comparing against the `"graduated"` literal
 * compiled untouched and silently took the pregrad branch, hiding the claim
 * button on a graduated receipt and pricing a venue-traded market off the
 * bonding curve. A grep is not a mechanism; this table is.
 */
type MarketStatusFacts = {
  /**
   * Whether reaching this status proves the market completed on-chain
   * graduation — a child market, a venue and outcome tokens exist, and the
   * pregrad receipt book is history.
   *
   * `cancelled` is `"either"` and not a mistake: a postgrad draw graduated
   * first, a pregrad admin-cancel never did, and the status alone cannot tell
   * them apart. Callers that must distinguish them read the terminal
   * resolution event; callers that only look data up use
   * {@link mayHaveGraduated}, where a pregrad cancel simply finds nothing.
   */
  graduation: "before" | "after" | "either";
  /** Whether the market is finished: no further status transition follows. */
  terminal: boolean;
};

const MARKET_STATUS_FACTS = {
  bootstrap: { graduation: "before", terminal: false },
  cancelled: { graduation: "either", terminal: true },
  disputed: { graduation: "after", terminal: false },
  graduated: { graduation: "after", terminal: false },
  graduating: { graduation: "before", terminal: false },
  refunded: { graduation: "before", terminal: true },
  rejected: { graduation: "before", terminal: true },
  resolution_pending: { graduation: "after", terminal: false },
  resolved: { graduation: "after", terminal: true },
  under_review: { graduation: "before", terminal: false },
} as const satisfies Record<MarketStatus, MarketStatusFacts>;

/**
 * The market completed on-chain graduation, so its child market, venue and
 * outcome tokens exist. True for the whole dispute window and after a terminal
 * resolution — a receipt on such a market settles into a position, never a
 * refund.
 *
 * Excludes `cancelled`, which cannot be told apart from a pregrad admin-cancel
 * by status alone; see {@link mayHaveGraduated}.
 */
export function hasGraduated(status: MarketStatus): boolean {
  return MARKET_STATUS_FACTS[status].graduation === "after";
}

/**
 * {@link hasGraduated} widened to admit `cancelled`, which a postgrad draw and
 * a pregrad admin-cancel both reach. Use it to *look up* postgrad data — the
 * lookup itself separates the two, because only a graduated market has a
 * GraduationFinalized row — never to decide what to render or pay out.
 */
export function mayHaveGraduated(status: MarketStatus): boolean {
  return MARKET_STATUS_FACTS[status].graduation !== "before";
}

/**
 * The market has graduated and its outcome is not final yet. A market spends
 * its whole dispute window here (repo ADR 0024): outcome tokens still trade at
 * the venue, so the venue — not the pregrad bonding curve, and not a
 * settlement price — is the price source, and the market still needs its
 * postgrad trading surfaces.
 */
export function isAwaitingResolution(status: MarketStatus): boolean {
  const facts = MARKET_STATUS_FACTS[status];
  return facts.graduation === "after" && !facts.terminal;
}

/**
 * Current state of each pregrad market — one row per (chainId, marketId),
 * updated in place by the indexer as events arrive. Point-in-time history
 * lives in the *_events tables, not here.
 */
export const markets = pgTable(
  "markets",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    contractId: integer("contract_id")
      .notNull()
      .references(() => contracts.id),
    marketId: bigint("market_id", { mode: "bigint" }).notNull(),
    status: marketStatus("status").default("under_review").notNull(),
    creator: text("creator").notNull(),
    metadataHash: varchar("metadata_hash", { length: 66 }).notNull(),
    collateral: text("collateral").notNull(),
    // These are EVM uint256 values. Use numeric(78, 0) via uint256 so realistic
    // WAD-sized market parameters survive round-trips through Postgres.
    openingProbabilityWad: uint256("opening_probability_wad").notNull(),
    liquidityParameter: uint256("liquidity_parameter").notNull(),
    graduationThreshold: uint256("graduation_threshold").notNull(),
    graduationTime: timestamp("graduation_time").notNull(),
    resolutionTime: timestamp("resolution_time").notNull(),
    // Early-YES resolution gate (AI resolution, ADR 0012): the earliest a YES may
    // resolve, a new on-chain createMarket parameter indexed from MarketCreated.
    // Null = no early YES (defaults to resolutionTime). resolutionTime itself is
    // the NO/draw gate (no_not_before). On-chain invariant:
    // graduationDeadline < yesNotBefore <= resolutionTime.
    yesNotBefore: timestamp("yes_not_before"),
    bypassAiResolution: boolean("bypass_ai_resolution")
      .default(false)
      .notNull(),
    // Mutable protocol counters and share totals also use uint256 storage for
    // the same reason, even though early smoke values are small.
    receiptCount: uint256("receipt_count")
      .default(sql`0`)
      .notNull(),
    totalEscrowed: uint256("total_escrowed")
      .default(sql`0`)
      .notNull(),
    yesShares: uint256("yes_shares")
      .default(sql`0`)
      .notNull(),
    noShares: uint256("no_shares")
      .default(sql`0`)
      .notNull(),
    createdBlockNumber: bigint("created_block_number", {
      mode: "bigint",
    }).notNull(),
    createdBlockTimestamp: timestamp("created_block_timestamp").notNull(),
    createdTransactionHash: text("created_transaction_hash").notNull(),
    createdLogIndex: integer("created_log_index").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("markets_chain_market_idx").on(table.chainId, table.marketId),
    unique("markets_chain_market_hash_idx").on(
      table.chainId,
      table.marketId,
      table.metadataHash,
    ),
    unique("markets_created_tx_log_idx").on(
      table.createdTransactionHash,
      table.createdLogIndex,
    ),
  ],
);
