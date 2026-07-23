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
 * Which redemption the postgrad market paid out: Redeemed (winning-side tokens
 * exchanged 1:1 for collateral after MarketResolved) or CancelledRedeemed
 * (YES+NO redeemed at half value after a MarketCancelled draw).
 */
export const POSTGRAD_REDEMPTION_KINDS = [
  "redeemed",
  "cancelled_redeemed",
] as const;

/** One of {@link POSTGRAD_REDEMPTION_KINDS}. */
export type PostgradRedemptionKind = (typeof POSTGRAD_REDEMPTION_KINDS)[number];

/** Postgres enum for PostgradRedemptionKind, derived from the same const array. */
export const postgradRedemptionKind = pgEnum("postgrad_redemption_kind", [
  ...POSTGRAD_REDEMPTION_KINDS,
]);

/** Side of the outcome tokens a Redeemed log burned; null for a draw. */
export const postgradRedemptionSide = pgEnum("postgrad_redemption_side", [
  "yes",
  "no",
]);

/**
 * Raw Redeemed/CancelledRedeemed logs from graduated CompleteSetBinaryMarket
 * contracts — the money paper trail for resolution redemptions
 * (docs/portfolio-data-design.md): each row is collateral that actually left
 * the market for `account`, sourced from the on-chain event. The token burn
 * side of the same transaction is captured independently by the
 * outcome-token Transfer watcher; this table records the collateral leg.
 * Deduped on (chain, tx, log) like the other *_events tables so indexer
 * replays stay idempotent.
 */
export const postgradRedemptionEvents = pgTable(
  "postgrad_redemption_events",
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
    account: text("account").notNull(),
    kind: postgradRedemptionKind("kind").notNull(),
    /** Set for `redeemed` rows; null for a cancelled-draw redemption. */
    side: postgradRedemptionSide("side"),
    /** Winning-side tokens burned by a `redeemed` row; null for a draw. */
    outcomeAmount: uint256("outcome_amount"),
    /** YES tokens burned by a `cancelled_redeemed` row; null otherwise. */
    yesAmount: uint256("yes_amount"),
    /** NO tokens burned by a `cancelled_redeemed` row; null otherwise. */
    noAmount: uint256("no_amount"),
    /** Collateral paid out to `account`, in raw collateral units. */
    collateralAmount: uint256("collateral_amount").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("postgrad_redemption_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    index("postgrad_redemption_events_chain_market_idx").on(
      table.chainId,
      table.marketId,
    ),
    index("postgrad_redemption_events_chain_account_idx").on(
      table.chainId,
      table.account,
    ),
  ],
);
