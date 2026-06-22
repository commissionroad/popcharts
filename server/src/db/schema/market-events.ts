import {
  boolean,
  bigint,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { contracts } from "./contracts";
import { uint256 } from "./uint256";

export const marketCreatedEvents = pgTable(
  "market_created_events",
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
    creator: text("creator").notNull(),
    metadataHash: varchar("metadata_hash", { length: 66 }).notNull(),
    collateral: text("collateral").notNull(),
    // WAD-scaled protocol values can exceed Postgres int64, so these use the
    // uint256 numeric mapper rather than pg bigint.
    openingProbabilityWad: uint256("opening_probability_wad").notNull(),
    liquidityParameter: uint256("liquidity_parameter").notNull(),
    graduationThreshold: uint256("graduation_threshold").notNull(),
    graduationTimeUnix: bigint("graduation_time_unix", {
      mode: "bigint",
    }).notNull(),
    resolutionTimeUnix: bigint("resolution_time_unix", {
      mode: "bigint",
    }).notNull(),
    graduationTime: timestamp("graduation_time").notNull(),
    resolutionTime: timestamp("resolution_time").notNull(),
    bypassAiResolution: boolean("bypass_ai_resolution")
      .default(false)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("market_created_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
  ],
);

export const receiptPlacedEvents = pgTable(
  "receipt_placed_events",
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
    receiptId: bigint("receipt_id", { mode: "bigint" }).notNull(),
    marketId: bigint("market_id", { mode: "bigint" }).notNull(),
    owner: text("owner").notNull(),
    side: integer("side").notNull(),
    shares: uint256("shares").notNull(),
    cost: uint256("cost").notNull(),
    rLow: text("r_low").notNull(),
    rHigh: text("r_high").notNull(),
    sequence: bigint("sequence", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("receipt_placed_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    uniqueIndex("receipt_placed_events_chain_receipt_idx").on(
      table.chainId,
      table.receiptId,
    ),
  ],
);
