import {
  bigint,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { contracts } from "./contracts";
import { MARKET_SIDE_VALUES } from "./market-side";

/**
 * Which terminal event the postgrad market emitted: MarketResolved(side) or
 * MarketCancelled() (a draw — YES and NO redeem at half). Distinct from the
 * pregrad admin-cancel event table (market_cancelled_events).
 */
export const POSTGRAD_RESOLUTION_KINDS = ["resolved", "cancelled"] as const;

/** One of {@link POSTGRAD_RESOLUTION_KINDS}. */
export type PostgradResolutionKind = (typeof POSTGRAD_RESOLUTION_KINDS)[number];

/** Postgres enum for PostgradResolutionKind, derived from the same const array. */
export const postgradResolutionKind = pgEnum("postgrad_resolution_kind", [
  ...POSTGRAD_RESOLUTION_KINDS,
]);

/** Winning side carried by MarketResolved; null for a cancelled draw. */
export const postgradWinningSide = pgEnum("postgrad_winning_side", [
  ...MARKET_SIDE_VALUES,
]);

/**
 * Raw MarketResolved/MarketCancelled logs from graduated CompleteSetBinaryMarket
 * contracts — the on-chain source of truth that drives markets.status into
 * `resolved`/`cancelled`, whichever actor resolved (AI runner, operator, or
 * trusted-creator self-resolve). The `markets` projection must stay rebuildable
 * from this table.
 */
export const postgradResolutionEvents = pgTable(
  "postgrad_resolution_events",
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
    kind: postgradResolutionKind("kind").notNull(),
    winningSide: postgradWinningSide("winning_side"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("postgrad_resolution_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
  ],
);
