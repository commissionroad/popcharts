import {
  bigint,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { contracts } from "./contracts";

/**
 * Raw AfterSwapTickObserved logs from the BoundedPredictionHook — the pool's
 * tick after every taker swap on a bounded pool. Taker swaps leave no other
 * database trace, so this stream is the price-history source for graduated
 * markets. Only the raw tick is stored; price derivation lives in the
 * API/app layer. Deduplicated on (chain, tx, log index) like the other
 * *_events tables so indexer replays stay idempotent.
 */
export const poolPriceTicks = pgTable(
  "pool_price_ticks",
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
    tick: integer("tick").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("pool_price_ticks_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    // Chart range queries: one pool's ticks over a block window.
    index("pool_price_ticks_chain_pool_block_idx").on(
      table.chainId,
      table.poolId,
      table.blockNumber,
    ),
  ],
);
