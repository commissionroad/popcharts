import {
  bigint,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Last processed block per (contract, chain, watcher), the indexer's recovery
 * checkpoint: on restart each watcher resumes from its cursor instead of
 * rescanning from the deploy block.
 */
export const indexerCursors = pgTable(
  "indexer_cursors",
  {
    id: serial("id").primaryKey(),
    contractAddress: text("contract_address").notNull(),
    chainId: integer("chain_id").notNull(),
    cursorName: text("cursor_name").notNull(),
    lastProcessedBlock: bigint("last_processed_block", {
      mode: "bigint",
    }).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("indexer_cursors_identity_idx").on(
      table.contractAddress,
      table.chainId,
      table.cursorName,
    ),
  ],
);
