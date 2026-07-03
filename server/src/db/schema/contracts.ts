import {
  integer,
  pgTable,
  serial,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Registry of watched protocol contract deployments, unique per (address,
 * chain). Markets and events reference rows here so a redeploy (new address)
 * keeps historical data attributable to the deployment that produced it.
 */
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
    unique("contracts_address_chain_idx").on(table.address, table.chainId),
  ],
);
