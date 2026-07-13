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

/**
 * Raw MarketCreated log per market, deduplicated on (chain, tx, log index) so
 * indexer replays and recovery scans stay idempotent — a pattern shared by all
 * *_events tables in this file, which are the append-only on-chain history
 * behind the mutable markets row.
 */
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
    metadata: text("metadata").default("").notNull(),
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

/** ReceiptPlaced logs — one row per bet receipt escrowed into a market. */
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

/** GraduationStarted logs — the frozen market snapshot entering graduation. */
export const graduationStartedEvents = pgTable(
  "graduation_started_events",
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
    manager: text("manager").notNull(),
    receiptCount: uint256("receipt_count").notNull(),
    totalEscrowed: uint256("total_escrowed").notNull(),
    path: text("path").notNull(),
    yesShares: uint256("yes_shares").notNull(),
    noShares: uint256("no_shares").notNull(),
    graduationStartedAtUnix: bigint("graduation_started_at_unix", {
      mode: "bigint",
    }).notNull(),
    graduationStartedAt: timestamp("graduation_started_at").notNull(),
    snapshotHash: varchar("snapshot_hash", { length: 66 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("graduation_started_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
  ],
);

/**
 * ClearingRootSubmitted logs — the proposed clearing Merkle root, its
 * settlement totals, and the challenge deadline that gates finalization.
 */
export const clearingRootSubmittedEvents = pgTable(
  "clearing_root_submitted_events",
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
    submitter: text("submitter").notNull(),
    merkleRoot: varchar("merkle_root", { length: 66 }).notNull(),
    snapshotHash: varchar("snapshot_hash", { length: 66 }).notNull(),
    matchedMarketCap: uint256("matched_market_cap").notNull(),
    retainedCostTotal: uint256("retained_cost_total").notNull(),
    refundTotal: uint256("refund_total").notNull(),
    completeSetCount: uint256("complete_set_count").notNull(),
    submittedAtUnix: bigint("submitted_at_unix", { mode: "bigint" }).notNull(),
    submittedAt: timestamp("submitted_at").notNull(),
    challengeDeadlineUnix: bigint("challenge_deadline_unix", {
      mode: "bigint",
    }).notNull(),
    challengeDeadline: timestamp("challenge_deadline").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("clearing_root_submitted_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
  ],
);

/**
 * GraduationFinalized logs — the settled totals and the postgrad
 * adapter/market the graduated positions moved to.
 */
export const graduationFinalizedEvents = pgTable(
  "graduation_finalized_events",
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
    postgradAdapter: text("postgrad_adapter").notNull(),
    postgradMarket: text("postgrad_market").notNull(),
    completeSetCount: uint256("complete_set_count").notNull(),
    retainedCostTotal: uint256("retained_cost_total").notNull(),
    refundTotal: uint256("refund_total").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("graduation_finalized_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
  ],
);

/** MarketRefundsAvailable logs — a market opened full-escrow refunds. */
export const marketRefundsAvailableEvents = pgTable(
  "market_refunds_available_events",
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
    totalEscrowed: uint256("total_escrowed").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("market_refunds_available_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
  ],
);

/** MarketCancelled logs — owner cancelled an inappropriate market, full refunds. */
export const marketCancelledEvents = pgTable(
  "market_cancelled_events",
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
    totalEscrowed: uint256("total_escrowed").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("market_cancelled_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
  ],
);

/**
 * GraduatedReceiptClaimed logs — per-receipt settlement claims, additionally
 * unique per (chain, receipt) because a receipt can only be claimed once.
 */
export const graduatedReceiptClaimedEvents = pgTable(
  "graduated_receipt_claimed_events",
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
    retainedShares: uint256("retained_shares").notNull(),
    retainedCost: uint256("retained_cost").notNull(),
    refund: uint256("refund").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("graduated_receipt_claimed_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    uniqueIndex("graduated_receipt_claimed_events_chain_receipt_idx").on(
      table.chainId,
      table.receiptId,
    ),
  ],
);

/**
 * RefundedReceiptClaimed logs — per-receipt refund claims on a refunded
 * market, unique per (chain, receipt) like graduated claims.
 */
export const refundedReceiptClaimedEvents = pgTable(
  "refunded_receipt_claimed_events",
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
    refund: uint256("refund").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("refunded_receipt_claimed_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    uniqueIndex("refunded_receipt_claimed_events_chain_receipt_idx").on(
      table.chainId,
      table.receiptId,
    ),
  ],
);
