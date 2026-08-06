import {
  bigint,
  foreignKey,
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
import { receiptPlacedEvents } from "./market-events";
import { markets } from "./markets";
import { uint256 } from "./uint256";

/**
 * The entry fee's lifecycle against one receipt (protocol ADR 0014 §3,
 * docs/fee-model.md). The fee is a second escrow, not revenue: `collected` at
 * placement, then exactly one terminal outcome per receipt — `refunded` in
 * full when the market never graduates, or split at a graduated claim into a
 * `refunded` share (the unmatched part) and an `earned` share (the matched
 * part). A fully-filled receipt emits only `earned`; a graduated-but-unfilled
 * one only `refunded`.
 */
export const entryFeeEventKind = pgEnum("entry_fee_event_kind", [
  "collected",
  "refunded",
  "earned",
]);

/**
 * Raw EntryFeeCollected / EntryFeeRefunded / EntryFeeEarned logs from the
 * PregradManager — the money paper trail for the pre-graduation entry fee
 * (protocol ADR 0014 §3, docs/portfolio-data-design.md invariant). Every fee
 * movement the contract makes emits exactly one of these, so summing a
 * receipt's rows by kind reconstructs its fee state at any block:
 * collected − refunded − earned is the amount still held refundable.
 *
 * Foreign-keyed to `receipt_placed_events` on (chainId, receiptId) and to
 * `markets` on (chainId, marketId), following the `market_ai_reviews`
 * composite pattern. EntryFeeCollected shares a transaction with
 * ReceiptPlaced but is consumed by an independent watcher, so on the live
 * path a fee log can arrive before its receipt row exists; the handler makes
 * that case a parkable retry rather than a raw constraint violation, which is
 * what keeps the foreign key safe (AGENTS.md).
 *
 * The fee rate defaults to zero on-chain and the contract only emits when an
 * amount is non-zero, so an absent row means "no fee was due", never "a
 * movement was missed". Deduped on (chain, tx, log) so replays stay
 * idempotent; append-only with no projection — a running balance belongs to
 * whichever build adds a surface that reads one.
 */
export const receiptEntryFeeEvents = pgTable(
  "receipt_entry_fee_events",
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
    /** Receipt the fee belongs to; foreign-keyed to `receipt_placed_events`. */
    receiptId: bigint("receipt_id", { mode: "bigint" }).notNull(),
    /** Market that owns the receipt; foreign-keyed to `markets`. */
    marketId: bigint("market_id", { mode: "bigint" }).notNull(),
    kind: entryFeeEventKind("kind").notNull(),
    /**
     * Wallet on the other side of the movement, lowercased: the payer for
     * `collected`, the refund recipient for `refunded`. Null exactly for
     * `earned`, where the counterparty is the protocol itself and the
     * contract emits no account.
     */
    account: text("account"),
    /** Fee amount moved, in raw collateral units. */
    amount: uint256("amount").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.chainId, table.receiptId],
      foreignColumns: [
        receiptPlacedEvents.chainId,
        receiptPlacedEvents.receiptId,
      ],
      name: "receipt_entry_fee_events_receipt_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      columns: [table.chainId, table.marketId],
      foreignColumns: [markets.chainId, markets.marketId],
      name: "receipt_entry_fee_events_market_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    uniqueIndex("receipt_entry_fee_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    index("receipt_entry_fee_events_chain_receipt_idx").on(
      table.chainId,
      table.receiptId,
    ),
    index("receipt_entry_fee_events_chain_market_idx").on(
      table.chainId,
      table.marketId,
    ),
  ],
);

/**
 * Raw EarnedEntryFeesWithdrawn logs — the owner sweeping a market's earned
 * entry fees out of the manager. Market-scoped rather than receipt-scoped
 * (the pot aggregates many receipts' earned shares), so it is a separate
 * table instead of a null-receipt row in the table above. Together the two
 * tables close the loop the money invariant requires: earned minus withdrawn
 * is the pot still held for ADR 0014 P5 pool seeding.
 */
export const entryFeeWithdrawalEvents = pgTable(
  "entry_fee_withdrawal_events",
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
    /** Market whose earned pot was withdrawn; foreign-keyed to `markets`. */
    marketId: bigint("market_id", { mode: "bigint" }).notNull(),
    /** Wallet that received the withdrawal, lowercased. */
    recipient: text("recipient").notNull(),
    /** Amount withdrawn, in raw collateral units. */
    amount: uint256("amount").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.chainId, table.marketId],
      foreignColumns: [markets.chainId, markets.marketId],
      name: "entry_fee_withdrawal_events_market_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    uniqueIndex("entry_fee_withdrawal_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    index("entry_fee_withdrawal_events_chain_market_idx").on(
      table.chainId,
      table.marketId,
    ),
  ],
);
