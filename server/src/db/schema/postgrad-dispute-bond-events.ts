import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { contracts } from "./contracts";
import { uint256 } from "./uint256";

/**
 * Which way the dispute bond moved: posted (collateral pulled from the
 * disputer into bond custody), refunded (the dispute was upheld and the bond
 * returned), or forfeited (the dispute failed and the bond went to the
 * protocol owner).
 */
export const POSTGRAD_DISPUTE_BOND_KINDS = [
  "posted",
  "refunded",
  "forfeited",
] as const;

/** One of {@link POSTGRAD_DISPUTE_BOND_KINDS}. */
export type PostgradDisputeBondKind =
  (typeof POSTGRAD_DISPUTE_BOND_KINDS)[number];

/** Postgres enum for PostgradDisputeBondKind, derived from the same const array. */
export const postgradDisputeBondKind = pgEnum("postgrad_dispute_bond_kind", [
  ...POSTGRAD_DISPUTE_BOND_KINDS,
]);

/**
 * Raw DisputeBondPosted/Refunded/Forfeited logs from graduated
 * CompleteSetBinaryMarket contracts — the money paper trail for the dispute
 * bond (docs/portfolio-data-design.md, repo ADR 0024): each row is collateral
 * that actually moved between `disputer` and bond custody, sourced from the
 * on-chain event rather than inferred from the status transition. Every column
 * is populated on every row, because all three kinds carry the same
 * (disputer, amount) pair. Deduped on (chain, tx, log) like the other *_events
 * tables so indexer replays stay idempotent.
 */
export const postgradDisputeBondEvents = pgTable(
  "postgrad_dispute_bond_events",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    contractId: integer("contract_id")
      .notNull()
      .references(() => contracts.id),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockTimestamp: timestamp("block_timestamp").notNull(),
    transactionHash: text("transaction_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    marketId: bigint("market_id", { mode: "bigint" }).notNull(),
    postgradMarket: text("postgrad_market").notNull(),
    kind: postgradDisputeBondKind("kind").notNull(),
    /** Wallet whose collateral moved, lowercased. */
    disputer: text("disputer").notNull(),
    /** Bond collateral moved by this log, in raw collateral units. */
    amount: uint256("amount").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("postgrad_dispute_bond_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    index("postgrad_dispute_bond_events_chain_market_idx").on(
      table.chainId,
      table.marketId,
    ),
  ],
);
