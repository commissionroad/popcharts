import {
  bigint,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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
