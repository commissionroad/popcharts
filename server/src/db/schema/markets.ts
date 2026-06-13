import {
  bigint,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { contracts } from "./contracts";

export const marketStatus = pgEnum("market_status", [
  "bootstrap",
  "graduating",
  "graduated",
  "resolved",
  "refunded",
  "cancelled",
]);

export const markets = pgTable(
  "markets",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    contractId: integer("contract_id")
      .notNull()
      .references(() => contracts.id),
    marketId: bigint("market_id", { mode: "bigint" }).notNull(),
    status: marketStatus("status").default("bootstrap").notNull(),
    creator: text("creator").notNull(),
    metadataHash: varchar("metadata_hash", { length: 66 }).notNull(),
    collateral: text("collateral").notNull(),
    openingProbabilityWad: bigint("opening_probability_wad", {
      mode: "bigint",
    }).notNull(),
    liquidityParameter: bigint("liquidity_parameter", {
      mode: "bigint",
    }).notNull(),
    graduationThreshold: bigint("graduation_threshold", {
      mode: "bigint",
    }).notNull(),
    graduationTime: timestamp("graduation_time").notNull(),
    resolutionTime: timestamp("resolution_time").notNull(),
    receiptCount: bigint("receipt_count", { mode: "bigint" })
      .default(sql`0`)
      .notNull(),
    totalEscrowed: bigint("total_escrowed", { mode: "bigint" })
      .default(sql`0`)
      .notNull(),
    yesShares: bigint("yes_shares", { mode: "bigint" })
      .default(sql`0`)
      .notNull(),
    noShares: bigint("no_shares", { mode: "bigint" })
      .default(sql`0`)
      .notNull(),
    createdBlockNumber: bigint("created_block_number", {
      mode: "bigint",
    }).notNull(),
    createdBlockTimestamp: timestamp("created_block_timestamp").notNull(),
    createdTransactionHash: text("created_transaction_hash").notNull(),
    createdLogIndex: integer("created_log_index").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("markets_chain_market_idx").on(table.chainId, table.marketId),
    uniqueIndex("markets_created_tx_log_idx").on(
      table.createdTransactionHash,
      table.createdLogIndex,
    ),
  ],
);
