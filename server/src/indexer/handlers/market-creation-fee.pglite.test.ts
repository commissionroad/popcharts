// Real-SQL tier for the creation-fee paper trail. Two things only real SQL
// can show: the dedupe is a unique index on (chain, tx, log), so a replayed
// log must be a no-op rather than a second payment record; and the row is
// foreign-keyed to `markets`, so a fee log that outruns the MarketCreated
// watcher must raise a *parkable* MarketNotIndexedError rather than a raw
// constraint violation, which would abandon the whole sweep pass.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";

import { count } from "drizzle-orm";

import type { db as productionDb } from "src/db/client";
import * as schema from "src/db/schema";
import {
  persistMarketCreationFeeRecord,
  type MarketCreationFeeRecord,
} from "src/indexer/handlers/market-creation-fee";
import { MarketNotIndexedError } from "src/indexer/handlers/market-projection";
import { createPgliteDb } from "src/test-support/pglite-db";

const CHAIN_ID = 31337;
const MARKET_ID = 7n;
const CREATOR = "0x00000000000000000000000000000000000000ab";

let dbc: typeof productionDb;
let resetDb: () => Promise<void>;
let teardownDb: () => Promise<void>;

beforeAll(async () => {
  ({ dbc, reset: resetDb, teardown: teardownDb } = await createPgliteDb());
});

afterAll(async () => {
  await teardownDb();
});

// One PGlite per file, emptied between tests — see the note in
// review-bond.pglite.test.ts on why an instance per test exhausts memory.
beforeEach(async () => {
  await resetDb();

  await dbc.insert(schema.contracts).values({
    address: "0x00000000000000000000000000000000000000cc",
    chainId: CHAIN_ID,
    name: "PregradManager",
  });
});

async function seedMarket() {
  await dbc.insert(schema.markets).values({
    chainId: CHAIN_ID,
    collateral: "0x00000000000000000000000000000000000000dd",
    contractId: 1,
    createdBlockNumber: 99n,
    createdBlockTimestamp: new Date("2026-08-04T00:00:00Z"),
    createdLogIndex: 0,
    createdTransactionHash: `0x${"33".repeat(32)}`,
    creator: CREATOR,
    graduationThreshold: 1_000_000n,
    graduationTime: new Date("2026-09-01T00:00:00Z"),
    liquidityParameter: 1_000_000_000n,
    marketId: MARKET_ID,
    metadataHash: `0x${"22".repeat(32)}`,
    openingProbabilityWad: 500_000_000_000_000_000n,
    resolutionTime: new Date("2026-10-01T00:00:00Z"),
    status: "under_review",
  });
}

function record(
  overrides: Partial<MarketCreationFeeRecord["event"]> = {},
): MarketCreationFeeRecord {
  return {
    event: {
      amount: 1_000_000_000_000_000_000n,
      blockNumber: 100n,
      blockTimestamp: new Date("2026-08-04T00:00:00Z"),
      chainId: CHAIN_ID,
      contractId: 1,
      creator: CREATOR,
      logIndex: 3,
      marketId: MARKET_ID,
      transactionHash: `0x${"11".repeat(32)}`,
      ...overrides,
    },
  };
}

describe("persistMarketCreationFeeRecord against real SQL (PGlite)", () => {
  it("records the fee once its market row exists", async () => {
    await seedMarket();

    await persistMarketCreationFeeRecord(record(), dbc);

    const [row] = await dbc
      .select({
        amount: schema.marketCreationFeeEvents.amount,
        creator: schema.marketCreationFeeEvents.creator,
        marketId: schema.marketCreationFeeEvents.marketId,
      })
      .from(schema.marketCreationFeeEvents);

    expect(row).toEqual({
      amount: 1_000_000_000_000_000_000n,
      creator: CREATOR,
      marketId: MARKET_ID,
    });
  });

  it("dedups a replayed log on (chain, tx, log) so a sweep replay never double-counts", async () => {
    await seedMarket();

    await persistMarketCreationFeeRecord(record(), dbc);
    await persistMarketCreationFeeRecord(record(), dbc);

    const [rows] = await dbc
      .select({ value: count() })
      .from(schema.marketCreationFeeEvents);
    expect(rows!.value).toBe(1);
  });

  it("asks to be retried when the fee log outruns MarketCreated", async () => {
    // No market row yet. The watcher wraps this in retryUntilMarketIndexed,
    // which only retries MarketNotIndexedError — and only a ParkSweepError
    // parks the sweep instead of abandoning the pass. A bare foreign-key
    // violation would satisfy neither, so the error's *type* is the contract
    // under test, not just the fact that it threw.
    await expect(persistMarketCreationFeeRecord(record(), dbc)).rejects.toThrow(
      MarketNotIndexedError,
    );

    const [rows] = await dbc
      .select({ value: count() })
      .from(schema.marketCreationFeeEvents);
    expect(rows!.value).toBe(0);
  });

  it("records the fee on a later attempt once the market lands", async () => {
    // The wait is not a drop: the same record persists unchanged after the
    // MarketCreated watcher catches up, which is what makes parking safe.
    await expect(
      persistMarketCreationFeeRecord(record(), dbc),
    ).rejects.toThrow();

    await seedMarket();
    await persistMarketCreationFeeRecord(record(), dbc);

    const [rows] = await dbc
      .select({ value: count() })
      .from(schema.marketCreationFeeEvents);
    expect(rows!.value).toBe(1);
  });
});
