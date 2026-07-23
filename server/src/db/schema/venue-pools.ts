import {
  boolean,
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { MARKET_SIDE_VALUES } from "./market-side";

/** Which binary outcome token a bounded-venue pool trades against collateral. */
export const venuePoolSide = pgEnum("venue_pool_side", [...MARKET_SIDE_VALUES]);

/**
 * Maps each bounded v4 venue pool to the graduated market and outcome it
 * trades, so venue order rows are queryable by market. Pool ids are
 * deterministic (keccak of the ADR 0007/0009 pool key), so rows are derived —
 * eagerly when GraduationFinalized lands and lazily from the first order
 * event — rather than parsed from any on-chain registration event.
 */
export const venuePools = pgTable(
  "venue_pools",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    poolId: varchar("pool_id", { length: 66 }).notNull(),
    marketId: bigint("market_id", { mode: "bigint" }).notNull(),
    side: venuePoolSide("side").notNull(),
    outcomeToken: text("outcome_token").notNull(),
    postgradMarket: text("postgrad_market").notNull(),
    // Whether the outcome token sorts as currency0 in the v4 pool key; needed
    // to interpret zeroForOne on orders as buy/sell of the outcome token.
    outcomeIsCurrency0: boolean("outcome_is_currency0").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("venue_pools_chain_pool_idx").on(table.chainId, table.poolId),
    index("venue_pools_chain_market_idx").on(table.chainId, table.marketId),
  ],
);
