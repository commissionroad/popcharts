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
 * Raw ERC-20 Transfer logs from graduated markets' outcome tokens,
 * deduplicated on (chain, tx, log index) like the other *_events tables so
 * indexer replays stay idempotent. Every balance change — graduation-claim
 * mints, venue pool swaps, limit-order pulls and fills, plain transfers —
 * surfaces as one Transfer, so this single stream is sufficient to project
 * exact per-wallet balances. Mint and burn legs keep the zero address in
 * from/to so total supply stays derivable from the raw log.
 */
export const outcomeTokenTransferEvents = pgTable(
  "outcome_token_transfer_events",
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
    outcomeToken: text("outcome_token").notNull(),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    value: uint256("value").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("outcome_token_transfer_events_chain_tx_log_idx").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    index("outcome_token_transfer_events_chain_token_idx").on(
      table.chainId,
      table.outcomeToken,
    ),
  ],
);
