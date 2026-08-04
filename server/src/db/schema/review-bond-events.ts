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
 * Which way review-credit value moved on-chain: a deposit crediting a
 * beneficiary, or the owner sweeping the collected balance. `settled` and
 * `bond_withdrawn` are retired — ADR 0022's prepaid-credit amendment removed
 * settlement and user withdrawal from the contract — but stay in the enum
 * because Postgres cannot drop an enum value in place; nothing writes them
 * any more.
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
 * Raw ReviewBondDeposited / ReviewFeesWithdrawn logs from the vault — the
 * money paper trail for prepaid review credit (ADR 0022 money invariant,
 * docs/portfolio-data-design.md): every value transfer through the vault is
 * event-sourced here, never inferred from the off-chain meter. These rows are
 * also what the submission gate reads: a wallet's credit is its summed
 * deposit rows minus the metered charges, never a direct chain read.
 * `account` is the credited beneficiary for deposits and the sweep recipient
 * for `fees_withdrawn`; `payer` is the wallet that sent a deposit (the
 * depositFor caller; null for sweeps and for legacy pre-amendment rows).
 * `runningTotal` carries a deposit's own cumulative lifetime figure (null for
 * sweeps, which report no cumulative on-chain). Deduped on (chain, tx, log)
 * like the other *_events tables so indexer replays stay idempotent.
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
    /** Credited beneficiary (or sweep recipient), lowercased. */
    account: text("account").notNull(),
    /** Wallet that sent a deposit, lowercased; null for sweeps and legacy rows. */
    payer: text("payer"),
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
