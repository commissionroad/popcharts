import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

export const marketMetadata = pgTable(
  "market_metadata",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    metadataHash: varchar("metadata_hash", { length: 66 }).notNull(),
    question: text("question").notNull(),
    description: text("description").notNull(),
    category: varchar("category", { length: 40 }).notNull(),
    resolutionCriteria: text("resolution_criteria").notNull(),
    resolutionUrl: text("resolution_url"),
    metadataCreatedAt: text("metadata_created_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("market_metadata_chain_hash_idx").on(
      table.chainId,
      table.metadataHash,
    ),
  ],
);
