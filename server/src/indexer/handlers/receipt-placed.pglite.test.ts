// ADR 0017 Track B PGlite spike: prove the unit-test substrate can verify
// SQL-level claims fake executors cannot — onConflict dedup via the real
// unique index, raw-SQL counter increments, and transaction rollback.
// Runs in-process with no Docker/Postgres; part of the plain unit suite.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { PGlite } from "@electric-sql/pglite";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";

import * as schema from "src/db/schema";
import type { db as productionDb } from "src/db/client";
import { MarketNotIndexedError } from "src/indexer/handlers/market-projection";
import {
  persistReceiptPlacedRecord,
  type ReceiptPlacedRecord,
} from "src/indexer/handlers/receipt-placed";

const CHAIN_ID = 31337;
const MARKET_ID = 7n;

const client = new PGlite();
// The handlers type their executor as `typeof db` (postgres-js drizzle);
// the PGlite drizzle instance is query-compatible but nominally distinct,
// so the spike casts. Track B item 4 makes injection first-class.
const dbc = drizzle(client, { schema }) as unknown as typeof productionDb;

function receiptRecord(
  overrides: Partial<ReceiptPlacedRecord> = {},
): ReceiptPlacedRecord {
  return {
    blockNumber: 100n,
    blockTimestamp: new Date("2026-07-14T00:00:00Z"),
    chainId: CHAIN_ID,
    contractId: 1,
    cost: 250n,
    logIndex: 3,
    marketId: MARKET_ID,
    owner: "0x00000000000000000000000000000000000000aa",
    rLow: "0",
    rHigh: "500000000000000000",
    receiptId: 1n,
    sequence: 1n,
    shares: 400n,
    side: 0,
    transactionHash: `0x${"11".repeat(32)}`,
    ...overrides,
  };
}

beforeAll(async () => {
  const { apply } = await pushSchema(
    schema,
    // drizzle-kit's parameter type lags behind drizzle-orm's instance types.
    dbc as unknown as Parameters<typeof pushSchema>[1],
  );
  await apply();

  await dbc.insert(schema.contracts).values({
    address: "0x00000000000000000000000000000000000000cc",
    chainId: CHAIN_ID,
    name: "PregradManager",
  });
  await dbc.insert(schema.markets).values({
    chainId: CHAIN_ID,
    contractId: 1,
    marketId: MARKET_ID,
    creator: "0x00000000000000000000000000000000000000aa",
    metadataHash: `0x${"22".repeat(32)}`,
    collateral: "0x00000000000000000000000000000000000000dd",
    openingProbabilityWad: 500000000000000000n,
    liquidityParameter: 1000000000n,
    graduationThreshold: 1000000n,
    graduationTime: new Date("2026-08-01T00:00:00Z"),
    resolutionTime: new Date("2026-09-01T00:00:00Z"),
    createdBlockNumber: 99n,
    createdBlockTimestamp: new Date("2026-07-13T00:00:00Z"),
    createdTransactionHash: `0x${"33".repeat(32)}`,
    createdLogIndex: 0,
  });
});

afterAll(async () => {
  await client.close();
});

async function marketCounters() {
  const [row] = await dbc
    .select({
      receiptCount: schema.markets.receiptCount,
      totalEscrowed: schema.markets.totalEscrowed,
      yesShares: schema.markets.yesShares,
      noShares: schema.markets.noShares,
    })
    .from(schema.markets)
    .where(eq(schema.markets.marketId, MARKET_ID));
  return row;
}

async function eventCount() {
  const [row] = await dbc
    .select({ value: count() })
    .from(schema.receiptPlacedEvents);
  return row.value;
}

describe("persistReceiptPlacedRecord against real SQL (PGlite)", () => {
  it("persists the event and applies the raw-SQL counter increments", async () => {
    await persistReceiptPlacedRecord(receiptRecord(), dbc);

    expect(await eventCount()).toBe(1);
    const market = await marketCounters();
    expect(market.receiptCount).toBe(1n);
    expect(market.totalEscrowed).toBe(250n);
    expect(market.yesShares).toBe(400n);
    expect(market.noShares).toBe(0n);
  });

  it("dedups a replay via the real unique index and skips the increments", async () => {
    await persistReceiptPlacedRecord(receiptRecord(), dbc);

    expect(await eventCount()).toBe(1);
    const market = await marketCounters();
    expect(market.totalEscrowed).toBe(250n);
    expect(market.yesShares).toBe(400n);
  });

  it("rolls back the event insert when the market projection is missing", async () => {
    const orphan = receiptRecord({
      marketId: 999n,
      receiptId: 2n,
      transactionHash: `0x${"44".repeat(32)}`,
    });

    await expect(persistReceiptPlacedRecord(orphan, dbc)).rejects.toThrow(
      MarketNotIndexedError,
    );
    // The transaction must not leave the event behind: a committed event
    // would make the dedup skip the counter updates on a later replay.
    expect(await eventCount()).toBe(1);
  });
});
