import { MARKET_STATUS, pregradManagerAbi } from "@popcharts/protocol";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import { config } from "src/config";
import { and, db, eq } from "src/db/client";

import { assertEqual } from "./asserts";
import {
  fetchApiMarket,
  pregradManagerAddress,
  publicClient,
  type ApiMarket,
} from "./stack";
import { waitForCondition } from "./wait";

/**
 * Market-scoped condition helpers shared by every scenario: API status
 * flips, indexed paper-trail rows, and on-chain status checks. One home so
 * the polling ergonomics (transient-error tolerance, tick throttling,
 * timeout diagnostics) evolve in one place.
 */

/** An event table scoped to one market: every paper-trail table qualifies. */
type MarketScopedTable = PgTable & {
  chainId: PgColumn;
  marketId: PgColumn;
};

/**
 * Waits until the read API serves the market with `status`, returning the
 * payload. `requirePostgrad` additionally demands the postgrad venue
 * address, which the indexer attaches a beat after the status flip.
 */
export async function waitForApiStatus(
  marketId: bigint,
  status: string,
  {
    requirePostgrad = false,
    timeoutMs,
  }: { requirePostgrad?: boolean; timeoutMs?: number } = {},
): Promise<ApiMarket> {
  return waitForCondition(
    `market ${marketId} reaches API status "${status}"`,
    async () => {
      const market = await fetchApiMarket(marketId);
      if (market?.status !== status) {
        return null;
      }
      if (requirePostgrad && !market.postgrad?.marketAddress) {
        return null;
      }
      return market;
    },
    { tickChain: true, ...(timeoutMs === undefined ? {} : { timeoutMs }) },
  );
}

/**
 * Waits until at least `minCount` rows for the market exist in an indexed
 * event table — the "this transfer reached the paper trail" primitive.
 */
export async function waitForIndexedRows<TTable extends MarketScopedTable>(
  label: string,
  table: TTable,
  marketId: bigint,
  minCount: number,
  { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
): Promise<TTable["$inferSelect"][]> {
  return waitForCondition(
    label,
    async () => {
      const rows = await db
        .select()
        .from(table as PgTable)
        .where(
          and(eq(table.chainId, config.chainId), eq(table.marketId, marketId)),
        );
      return rows.length >= minCount
        ? (rows as TTable["$inferSelect"][])
        : null;
    },
    { tickChain: true, timeoutMs },
  );
}

/** Asserts the market's on-chain PregradManager status code. */
export async function assertChainStatus(
  label: string,
  marketId: bigint,
  expected: (typeof MARKET_STATUS)[keyof typeof MARKET_STATUS],
): Promise<void> {
  const state = await publicClient.readContract({
    abi: pregradManagerAbi,
    address: pregradManagerAddress,
    functionName: "getMarketState",
    args: [marketId],
  });
  assertEqual(label, Number(state.status), expected);
}
