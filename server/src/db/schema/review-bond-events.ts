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
 * Which way review-bond value moved on-chain: a user deposit into the vault,
 * a resolver settlement moving consumed value into the collected pool, a user
 * withdrawal of unconsumed bond, or the owner sweeping collected fees.
 */
export const REVIEW_BOND_EVENT_KINDS = [
  "deposited",
  "settled",
  "bond_withdrawn",
  "fees_withdrawn",
] as const;

/** One of {@link REVIEW_BOND_EVENT_KINDS}. */
export type ReviewBondEventKind = (typeof REVIEW_BOND_EVENT_KINDS)[number];

/** Postgres enum for ReviewBondEventKind, derived from the same const array. */
export const reviewBondEventKind = pgEnum("review_bond_event_kind", [
  ...REVIEW_BOND_EVENT_KINDS,
]);

/**
 * Raw ReviewBondDeposited / ReviewFeesSettled / ReviewBondWithdrawn /
 * ReviewFeesWithdrawn logs from the ReviewBondVault — the money paper trail
 * for the review bond (ADR 0022 money invariant,
 * docs/portfolio-data-design.md): every value transfer through the vault is
 * event-sourced here, never inferred from the off-chain meter. `account` is
 * the bonded user for the first three kinds and the sweep recipient for
 * `fees_withdrawn`. `runningTotal` carries the event's own cumulative figure
 * (lifetime deposits after a deposit, lifetime settled consumption after a
 * settlement, remaining available after a withdrawal; null for sweeps), so
 * the meter can reconcile against on-chain state without replaying history.
 * Deduped on (chain, tx, log) like the other *_events tables so indexer
 * replays stay idempotent.
 */
export const reviewBondEvents = pgTable(
  "review_bond_events",
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
    kind: reviewBondEventKind("kind").notNull(),
    /** Bonded user (or sweep recipient for fees_withdrawn), lowercased. */
    account: text("account").notNull(),
    /** Native value this log moved, in raw units. */
    amount: uint256("amount").notNull(),
    /** The event's own cumulative figure; null for fee sweeps. */
    runningTotal: uint256("running_total"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("review_bond_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    index("review_bond_events_chain_account_idx").on(
      table.chainId,
      table.account,
    ),
  ],
);
