// ADR 0017 Track B PGlite spike: prove the unit-test substrate can verify
// SQL-level claims fake executors cannot — onConflict dedup via the real
// unique index, raw-SQL counter increments, and transaction rollback.
// Runs in-process with no Docker/Postgres; part of the plain unit suite.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { count, eq } from "drizzle-orm";

import * as schema from "src/db/schema";
import type { db as productionDb } from "src/db/client";
import { createPgliteDb } from "src/test-support/pglite-db";
import { MarketNotIndexedError } from "src/indexer/handlers/market-projection";
import {
  persistReceiptPlacedRecord,
  type ReceiptPlacedRecord,
} from "src/indexer/handlers/receipt-placed";

const CHAIN_ID = 31337;
const MARKET_ID = 7n;

let dbc: typeof productionDb;
let teardownDb: () => Promise<void>;

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
  ({ dbc, teardown: teardownDb } = await createPgliteDb());

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
  await teardownDb();
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

async function changeFeedRows() {
  return dbc
    .select({
      sourceTable: schema.changeFeed.sourceTable,
      payload: schema.changeFeed.payload,
    })
    .from(schema.changeFeed);
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

  it("records a change_feed row carrying the trade's price tick", async () => {
    await persistReceiptPlacedRecord(receiptRecord(), dbc);

    const rows = await changeFeedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceTable).toBe("receipt_placed_events");

    // The tick round-trips through the jsonb column with its shape intact and
    // complementary prices; the exact cents are the LMSR's job (unit-tested in
    // receipt-price-tick.test.ts), so assert the contract, not the value.
    const tick = rows[0]?.payload;
    expect(tick?.sequence).toBe(1);
    expect(tick?.t).toBe("2026-07-14T00:00:00.000Z");
    expect(typeof tick?.yesPriceCents).toBe("number");
    expect((tick?.yesPriceCents ?? 0) + (tick?.noPriceCents ?? 0)).toBe(100);
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
    const orphanRows = await dbc
      .select({ id: schema.receiptPlacedEvents.id })
      .from(schema.receiptPlacedEvents)
      .where(
        eq(schema.receiptPlacedEvents.transactionHash, orphan.transactionHash),
      );
    expect(orphanRows).toHaveLength(0);
  });
});
