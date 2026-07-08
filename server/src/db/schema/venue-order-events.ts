import {
  boolean,
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { contracts } from "./contracts";
import { uint256 } from "./uint256";

/** Discriminates which BoundedPoolOrderManager order event a row records. */
export const venueOrderEventType = pgEnum("venue_order_event_type", [
  "created",
  "cancelled",
  "filled",
  "partially_filled",
  "requeued",
]);

/**
 * Raw BoundedPoolOrderManager order lifecycle logs, deduplicated on
 * (chain, tx, log index) like the pregrad *_events tables so indexer replays
 * stay idempotent. The five order events share the (poolId, orderId, owner)
 * key and are read interleaved as per-order history, so they live in one
 * discriminated table instead of five near-identical ones; columns not
 * carried by an event type stay null.
 */
export const venueOrderEvents = pgTable(
  "venue_order_events",
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
    poolId: varchar("pool_id", { length: 66 }).notNull(),
    orderId: bigint("order_id", { mode: "number" }).notNull(),
    eventType: venueOrderEventType("event_type").notNull(),
    // OrderRequeued carries no owner.
    owner: text("owner"),
    zeroForOne: boolean("zero_for_one"),
    tickLower: integer("tick_lower"),
    tickUpper: integer("tick_upper"),
    liquidity: uint256("liquidity"),
    amountIn: uint256("amount_in"),
    // Maker payouts for fills; returned inventory for cancellations.
    amount0: uint256("amount0"),
    amount1: uint256("amount1"),
    // OrderPartiallyFilled's indexedTick, or OrderRequeued's thresholdTick —
    // both are "where the order is indexed for execution now".
    indexedTick: integer("indexed_tick"),
    remainingLiquidity: uint256("remaining_liquidity"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("venue_order_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    index("venue_order_events_chain_pool_order_idx").on(
      table.chainId,
      table.poolId,
      table.orderId,
    ),
  ],
);
