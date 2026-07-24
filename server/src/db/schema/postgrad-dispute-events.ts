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

import { MARKET_SIDES } from "@popcharts/protocol";

import { contracts } from "./contracts";

/**
 * Which step of the pre-terminal resolution lifecycle the postgrad market
 * emitted: ResolutionProposed(side, disputeDeadline) opening the dispute
 * window, or ResolutionDisputed(disputer, bond) freezing the market for human
 * adjudication. The terminal MarketResolved/MarketCancelled logs stay in
 * postgrad_resolution_events, which is deliberately terminal-only.
 */
export const POSTGRAD_DISPUTE_KINDS = ["proposed", "disputed"] as const;

/** One of {@link POSTGRAD_DISPUTE_KINDS}. */
export type PostgradDisputeKind = (typeof POSTGRAD_DISPUTE_KINDS)[number];

/** Postgres enum for PostgradDisputeKind, derived from the same const array. */
export const postgradDisputeKind = pgEnum("postgrad_dispute_kind", [
  ...POSTGRAD_DISPUTE_KINDS,
]);

/** Side the resolver proposed; null on a `disputed` row. */
export const postgradProposedSide = pgEnum("postgrad_proposed_side", [
  ...MARKET_SIDES,
]);

/**
 * Raw ResolutionProposed/ResolutionDisputed logs from graduated
 * CompleteSetBinaryMarket contracts (repo ADR 0024, protocol ADR 0013) — the
 * on-chain source of truth that drives markets.status into
 * `resolution_pending`/`disputed` before a terminal resolution lands. The
 * `markets` projection must stay rebuildable from this table together with
 * postgrad_resolution_events.
 *
 * The bond a disputer posted is NOT duplicated here: `dispute()` emits
 * DisputeBondPosted in the same transaction and that is the money paper-trail
 * record (postgrad_dispute_bond_events). This table carries only the
 * status-lifecycle facts. Deduped on (chain, tx, log) like the other *_events
 * tables so indexer replays stay idempotent.
 */
export const postgradDisputeEvents = pgTable(
  "postgrad_dispute_events",
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
    kind: postgradDisputeKind("kind").notNull(),
    /** Side carried by ResolutionProposed; null on a `disputed` row. */
    proposedSide: postgradProposedSide("proposed_side"),
    /**
     * When the dispute window closes and anyone may finalize, from
     * ResolutionProposed's uint64 unix seconds; null on a `disputed` row.
     */
    disputeDeadline: timestamp("dispute_deadline"),
    /** Wallet that disputed, lowercased; null on a `proposed` row. */
    disputer: text("disputer"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("postgrad_dispute_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    index("postgrad_dispute_events_chain_market_idx").on(
      table.chainId,
      table.marketId,
    ),
  ],
);
