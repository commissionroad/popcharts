import {
  bigint,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { contracts } from "./contracts";
import { uint256 } from "./uint256";

/**
 * Raw MarketCreationFeePaid logs from the PregradManager's creation-fee base —
 * the money paper trail for the market creation fee (ADR 0022,
 * docs/portfolio-data-design.md). The fee is collected atomically inside
 * `createMarket`, so this row is the only record that a creator actually paid
 * it; before this table the fee was the one value transfer in the system with
 * no event-sourced record.
 *
 * `marketId` is a plain column with no foreign key to `markets`, matching the
 * other market-scoped `*_events` tables: the fee log and `MarketCreated` are
 * emitted in the same transaction but consumed by independent watchers, so
 * requiring the market row first would make the money record depend on
 * projection ordering. Deduped on (chain, tx, log) like the other `*_events`
 * tables so indexer replays stay idempotent.
 *
 * Trusted creators pay nothing and the contract emits no log for them
 * (`createMarket` only emits when the fee is non-zero), so an absent row means
 * "no fee was due", never "a payment was missed".
 */
export const marketCreationFeeEvents = pgTable(
  "market_creation_fee_events",
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
    /** Market the fee bought. No FK — see the table comment. */
    marketId: bigint("market_id", { mode: "bigint" }).notNull(),
    /** Wallet that paid the fee, lowercased. */
    creator: text("creator").notNull(),
    /** Fee paid, in raw native units. */
    amount: uint256("amount").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("market_creation_fee_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    index("market_creation_fee_events_chain_market_idx").on(
      table.chainId,
      table.marketId,
    ),
    index("market_creation_fee_events_chain_creator_idx").on(
      table.chainId,
      table.creator,
    ),
  ],
);
