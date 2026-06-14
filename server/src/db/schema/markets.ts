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
import { uint256 } from "./uint256";

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
    // These are EVM uint256 values. Use numeric(78, 0) via uint256 so realistic
    // WAD-sized market parameters survive round-trips through Postgres.
    openingProbabilityWad: uint256("opening_probability_wad").notNull(),
    liquidityParameter: uint256("liquidity_parameter").notNull(),
    graduationThreshold: uint256("graduation_threshold").notNull(),
    graduationTime: timestamp("graduation_time").notNull(),
    resolutionTime: timestamp("resolution_time").notNull(),
    // Mutable protocol counters and share totals also use uint256 storage for
    // the same reason, even though early smoke values are small.
    receiptCount: uint256("receipt_count")
      .default(sql`0`)
      .notNull(),
    totalEscrowed: uint256("total_escrowed")
      .default(sql`0`)
      .notNull(),
    yesShares: uint256("yes_shares")
      .default(sql`0`)
      .notNull(),
    noShares: uint256("no_shares")
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
