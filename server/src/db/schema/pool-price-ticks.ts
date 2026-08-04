import {
  bigint,
  bigserial,
  index,
  integer,
  pgTable,
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
 * markets. Only raw event fields are stored (tick and the hook's per-pool
 * sequence); cent prices are derived — at the emit seam for the live tick
 * payload and in the API for historical reads, both through the shared
 * venue-price module, a deliberate reversal (repo ADR 0025) of the earlier
 * derive-only-in-the-API rule. Deduplicated on (chain, tx, log index) like
 * the other *_events tables so indexer replays stay idempotent.
 */
export const poolPriceTicks = pgTable(
  "pool_price_ticks",
  {
    // bigserial, not serial: replays burn sequence values even on
    // ON CONFLICT DO NOTHING, and this table gets a row per swap.
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
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
    // The hook's per-pool swap ordinal (contiguous from 1 over successful
    // swaps, repo ADR 0025) — the stream sequence a live tick carries so the
    // client can detect a missed swap. Persisted so a historical read serves
    // the same ordinal a live frame did.
    sequence: bigint("sequence", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("pool_price_ticks_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    // Chart range queries: one pool's ticks over a wall-clock window, in
    // deterministic order when one block holds several swaps.
    index("pool_price_ticks_chain_pool_time_idx").on(
      table.chainId,
      table.poolId,
      table.blockTimestamp,
      table.logIndex,
    ),
  ],
);
