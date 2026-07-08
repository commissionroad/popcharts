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

import { uint256 } from "./uint256";

/**
 * Lifecycle of a maker order as tracked off-chain: OrderCreated opens it, and
 * OrderFilled / a partial fill that empties the range / OrderCancelled
 * terminate it.
 */
export const venueOrderStatus = pgEnum("venue_order_status", [
  "open",
  "filled",
  "cancelled",
]);

/**
 * Current state of each bounded-venue maker order — one row per
 * (chainId, poolId, orderId), updated in place as order lifecycle events
 * arrive. Point-in-time history lives in venue_order_events. updatedBlock
 * fields record the newest event applied so out-of-order replays cannot
 * regress the projection.
 */
export const venueOrders = pgTable(
  "venue_orders",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    poolId: varchar("pool_id", { length: 66 }).notNull(),
    // Per-pool uint32 order id; exceeds signed int32, so pg bigint.
    orderId: bigint("order_id", { mode: "number" }).notNull(),
    owner: text("owner").notNull(),
    zeroForOne: boolean("zero_for_one").notNull(),
    tickLower: integer("tick_lower").notNull(),
    tickUpper: integer("tick_upper").notNull(),
    // The execution-index tick is not part of OrderCreated (the contract
    // derives it from the fill mode), so it stays null until an
    // OrderPartiallyFilled or OrderRequeued event reports it.
    indexedTick: integer("indexed_tick"),
    // Not emitted by any event either; inferred true once a partial fill is
    // observed, null while unknown.
    enablePartialFill: boolean("enable_partial_fill"),
    liquidity: uint256("liquidity").notNull(),
    remainingLiquidity: uint256("remaining_liquidity").notNull(),
    amountIn: uint256("amount_in").notNull(),
    // Cumulative maker payouts from OrderFilled/OrderPartiallyFilled.
    filledAmount0: uint256("filled_amount0").notNull(),
    filledAmount1: uint256("filled_amount1").notNull(),
    status: venueOrderStatus("status").default("open").notNull(),
    createdBlockNumber: bigint("created_block_number", {
      mode: "bigint",
    }).notNull(),
    createdBlockTimestamp: timestamp("created_block_timestamp").notNull(),
    createdTransactionHash: text("created_transaction_hash").notNull(),
    createdLogIndex: integer("created_log_index").notNull(),
    updatedBlockNumber: bigint("updated_block_number", {
      mode: "bigint",
    }).notNull(),
    updatedLogIndex: integer("updated_log_index").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("venue_orders_chain_pool_order_idx").on(
      table.chainId,
      table.poolId,
      table.orderId,
    ),
    index("venue_orders_chain_pool_status_idx").on(
      table.chainId,
      table.poolId,
      table.status,
    ),
    index("venue_orders_chain_owner_status_idx").on(
      table.chainId,
      table.owner,
      table.status,
    ),
  ],
);
