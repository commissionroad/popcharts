import {
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const contracts = pgTable(
  "contracts",
  {
    id: serial("id").primaryKey(),
    address: varchar("address", { length: 42 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    chainId: integer("chain_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("contracts_address_chain_idx").on(table.address, table.chainId),
  ],
);
