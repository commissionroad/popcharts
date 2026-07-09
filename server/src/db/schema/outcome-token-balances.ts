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

import { uint256 } from "./uint256";
import { venuePoolSide } from "./venue-pools";

/**
 * Per-wallet outcome-token holdings, projected from
 * outcome_token_transfer_events by debiting `from` and crediting `to` on each
 * fresh Transfer (zero-address mint/burn legs skip the holder row). This is
 * the wallet's *held* balance only: tokens committed to the wallet's own
 * resting venue orders are pulled into the v4 pool manager and are tracked in
 * venue_orders, so "owned" reads join both. marketId/side are denormalized
 * from venue_pools (a token maps to exactly one market outcome, fixed at
 * graduation) so portfolio queries skip the join.
 */
export const outcomeTokenBalances = pgTable(
  "outcome_token_balances",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    outcomeToken: text("outcome_token").notNull(),
    owner: text("owner").notNull(),
    marketId: bigint("market_id", { mode: "bigint" }).notNull(),
    side: venuePoolSide("side").notNull(),
    // numeric(78,0) is signed, so a debit applied before its matching credit
    // during replay can hold a transient negative without failing; deltas
    // commute, so the settled sum is exact.
    balance: uint256("balance").notNull(),
    updatedBlockNumber: bigint("updated_block_number", {
      mode: "bigint",
    }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("outcome_token_balances_chain_token_owner_idx").on(
      table.chainId,
      table.outcomeToken,
      table.owner,
    ),
    index("outcome_token_balances_chain_owner_idx").on(
      table.chainId,
      table.owner,
    ),
  ],
);
