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
 * The withdrawal request's lifecycle against one receipt (protocol ADR 0014
 * P3): `requested` opens exactly one pending request per receipt, then
 * exactly one terminal row per request — `finalized` (paid), `refuted`
 * (challenged away), or `voided` (market left Active first). Grouping rows by
 * requestId replays the state machine; only `finalized` moves money.
 */
export const withdrawalEventKind = pgEnum("withdrawal_event_kind", [
  "requested",
  "refuted",
  "finalized",
  "voided",
]);

/**
 * Canonical text encoding for `receipt_withdrawal_events.segments`: one
 * `rLow:rHigh` pair per claimed segment, comma-joined in event order (the
 * contract enforces ascending, disjoint segments). Defined beside the column
 * and shared by the indexer handler and the nightly reconciler, so the stored
 * value and the chain-side comparison cannot drift apart.
 */
export function serializeWithdrawalSegments(
  segments: readonly { rHigh: bigint; rLow: bigint }[],
): string {
  return segments
    .map((segment) => `${segment.rLow}:${segment.rHigh}`)
    .join(",");
}

/**
 * Raw ReceiptWithdrawalRequested / Refuted / Finalized / Voided logs from the
 * PregradManager — the paper trail for pre-graduation withdrawals (protocol
 * ADR 0014 P3, docs/portfolio-data-design.md invariant). One kind-discriminated
 * table like `receipt_entry_fee_events` rather than four: the four events are
 * one request lifecycle sharing (requestId, receiptId, marketId), and a
 * per-kind split would scatter each request's history across tables.
 *
 * Money columns are stamped from the events, never derived: `requested`
 * records the priced claim (grossRefund, the request-time withdrawalFee, and
 * the pro-rated entryFeeRefund) before any transfer, and `finalized` records
 * the one transfer that settles it — escrowRefund (= grossRefund −
 * withdrawalFee) plus entryFeeRefund paid to the owner, withdrawalFee kept.
 * `refuted` and `voided` move nothing. Columns are null exactly where the
 * event does not carry them.
 *
 * Foreign-keyed to `receipt_placed_events` on (chainId, receiptId) — twice:
 * once for the withdrawing receipt, once for `refuting_receipt_id`, the
 * opposite-side receipt a challenger named — and to `markets` on
 * (chainId, marketId), the `market_ai_reviews` composite pattern. All three
 * parents come from independent watchers, so the handler makes a missing
 * parent a parkable retry rather than a raw constraint violation, which is
 * what keeps the foreign keys safe (AGENTS.md). Deduped on (chain, tx, log)
 * so replays stay idempotent; append-only with no projection.
 */
export const receiptWithdrawalEvents = pgTable(
  "receipt_withdrawal_events",
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
    /** Contract-assigned withdrawal request id all four kinds share. */
    requestId: bigint("request_id", { mode: "bigint" }).notNull(),
    /** Receipt being withdrawn from; foreign-keyed to `receipt_placed_events`. */
    receiptId: bigint("receipt_id", { mode: "bigint" }).notNull(),
    /** Market that owns the receipt; foreign-keyed to `markets`. */
    marketId: bigint("market_id", { mode: "bigint" }).notNull(),
    kind: withdrawalEventKind("kind").notNull(),
    /**
     * Wallet the event names, lowercased: the receipt owner for `requested`
     * and `finalized` (the payee), the challenger for `refuted`. Null exactly
     * for `voided`, where the contract emits no address.
     */
    account: text("account"),
    /**
     * Claimed segments in the canonical `serializeWithdrawalSegments` text
     * encoding; only on `requested`.
     */
    segments: text("segments"),
    /** Recorded path cost of the claimed segments; only on `requested`. */
    grossRefund: uint256("gross_refund"),
    /**
     * Fee stamped at the request-time rate, earned at finalization; on
     * `requested` and `finalized` (equal for one request by construction —
     * store-don't-derive, ADR 0014 §3).
     */
    withdrawalFee: uint256("withdrawal_fee"),
    /**
     * Prepaid entry-fee share returning with the withdrawal; on `requested`
     * and `finalized`. The finalized amount is also written as a `refunded`
     * row in `receipt_entry_fee_events` — see that handler's conservation
     * note.
     */
    entryFeeRefund: uint256("entry_fee_refund"),
    /** Escrow paid out (grossRefund − withdrawalFee); only on `finalized`. */
    escrowRefund: uint256("escrow_refund"),
    /** Challenge deadline in unix seconds as emitted; only on `requested`. */
    challengeDeadlineUnix: bigint("challenge_deadline_unix", {
      mode: "bigint",
    }),
    /** `challengeDeadlineUnix` as a timestamp; only on `requested`. */
    challengeDeadline: timestamp("challenge_deadline"),
    /** Refutation-set bound stamped by the contract; only on `requested`. */
    nextReceiptIdSnapshot: bigint("next_receipt_id_snapshot", {
      mode: "bigint",
    }),
    /**
     * Opposite-side receipt named by the challenger; only on `refuted`.
     * Foreign-keyed to `receipt_placed_events` (NULL rows skip the check).
     */
    refutingReceiptId: bigint("refuting_receipt_id", { mode: "bigint" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.chainId, table.receiptId],
      foreignColumns: [
        receiptPlacedEvents.chainId,
        receiptPlacedEvents.receiptId,
      ],
      name: "receipt_withdrawal_events_receipt_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      columns: [table.chainId, table.marketId],
      foreignColumns: [markets.chainId, markets.marketId],
      name: "receipt_withdrawal_events_market_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      columns: [table.chainId, table.refutingReceiptId],
      foreignColumns: [
        receiptPlacedEvents.chainId,
        receiptPlacedEvents.receiptId,
      ],
      name: "receipt_withdrawal_events_refuting_receipt_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    uniqueIndex("receipt_withdrawal_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    index("receipt_withdrawal_events_chain_request_idx").on(
      table.chainId,
      table.requestId,
    ),
    index("receipt_withdrawal_events_chain_receipt_idx").on(
      table.chainId,
      table.receiptId,
    ),
    index("receipt_withdrawal_events_chain_market_idx").on(
      table.chainId,
      table.marketId,
    ),
  ],
);

/**
 * Which manager-wide withdrawal parameter changed: the fee rate (WAD, from
 * WithdrawalFeeRateUpdated) or the challenge period (seconds, from
 * WithdrawalChallengePeriodUpdated).
 */
export const withdrawalConfigKind = pgEnum("withdrawal_config_kind", [
  "fee_rate",
  "challenge_period",
]);

/**
 * Raw WithdrawalFeeRateUpdated / WithdrawalChallengePeriodUpdated logs — the
 * owner arming or tuning the withdrawal surface. Manager-global, not
 * market-scoped, so no market foreign key exists to give it; both events
 * share the previous → new shape, so one kind-discriminated table holds both.
 * Not a value transfer — kept because a fee amount is only auditable against
 * the rate that was live when its request was stamped.
 */
export const withdrawalConfigEvents = pgTable(
  "withdrawal_config_events",
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
    kind: withdrawalConfigKind("kind").notNull(),
    /** Value before the change: WAD rate for `fee_rate`, seconds for `challenge_period`. */
    previousValue: uint256("previous_value").notNull(),
    /** Value after the change, same units as `previousValue`. */
    newValue: uint256("new_value").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("withdrawal_config_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
  ],
);

/**
 * Raw EarnedWithdrawalFeesWithdrawn logs — the owner sweeping a market's
 * earned withdrawal fees out of the manager, the exact sibling of
 * `entry_fee_withdrawal_events` for the withdrawal-fee pot (a deliberately
 * separate pot: entry fees earn only at clearing and refund on the
 * non-graduation paths, withdrawal fees are earned on the act and kept in
 * every case — ADR 0014 §3/P4b). Market-scoped rather than receipt-scoped:
 * the pot aggregates many requests' fees.
 */
export const withdrawalFeeWithdrawalEvents = pgTable(
  "withdrawal_fee_withdrawal_events",
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
      name: "withdrawal_fee_withdrawal_events_market_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    uniqueIndex("withdrawal_fee_withdrawal_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    index("withdrawal_fee_withdrawal_events_chain_market_idx").on(
      table.chainId,
      table.marketId,
    ),
  ],
);
