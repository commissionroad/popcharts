import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { contracts } from "./contracts";
import { uint256 } from "./uint256";

/**
 * Which direction the complete-set collateral moved: minted (collateral in,
 * YES+NO sets out) or merged (YES+NO sets in, collateral out).
 */
export const completeSetKind = pgEnum("complete_set_kind", [
  "minted",
  "merged",
]);

/**
 * Raw CompleteSetsMinted/CompleteSetsMerged logs from graduated
 * CompleteSetBinaryMarket contracts — the money paper trail for collateral
 * entering (mint) and leaving (merge) a market outside resolution
 * (docs/portfolio-data-design.md): each row is collateral the market actually
 * pulled from or returned to `account`, sourced from the on-chain event. The
 * matching YES/NO token mints and burns surface independently through the
 * outcome-token Transfer watcher; this table records the collateral leg.
 * Deduped on (chain, tx, log) like the other *_events tables so indexer
 * replays stay idempotent.
 */
export const completeSetEvents = pgTable(
  "complete_set_events",
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
    kind: completeSetKind("kind").notNull(),
    /**
     * Wallet whose collateral moved: minted's `caller` (mintCompleteSets
     * pulls collateral from msg.sender), merged's `account` (collateral is
     * paid back to msg.sender).
     */
    account: text("account").notNull(),
    /** Minted's `to` when the YES/NO sets went to someone other than the payer; null otherwise. */
    recipient: text("recipient"),
    /** Collateral pulled in (minted) or paid out (merged), raw collateral units. */
    collateralAmount: uint256("collateral_amount").notNull(),
    /** Complete sets minted or merged (one YES + one NO each). */
    outcomeAmount: uint256("outcome_amount").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("complete_set_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    index("complete_set_events_chain_market_idx").on(
      table.chainId,
      table.marketId,
    ),
  ],
);
