// Real-SQL tier for the venue price-history reads. The service's own suite
// injects these selectors, so nothing there would notice a wrong column, a
// missing chain filter, or an ordering that only holds by luck of insertion.
// A route test cannot reach them either: the moment a market has indexed pools
// the service also reads the collateral's decimals off-chain.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";

import type { db as productionDb } from "src/db/client";
import { setDbForTesting } from "src/db/client";
import * as schema from "src/db/schema";
import { createPgliteDb } from "src/test-support/pglite-db";

import { venuePriceHistoryReads } from "./venue-price-history";

const CHAIN_ID = 31337;
const OTHER_CHAIN_ID = 8453;
const MARKET_ID = 7n;
const OTHER_MARKET_ID = 8n;
const YES_POOL_ID = `0x${"aa".repeat(32)}`;
const NO_POOL_ID = `0x${"bb".repeat(32)}`;
const FOREIGN_POOL_ID = `0x${"cc".repeat(32)}`;
const POSTGRAD_MARKET = "0x00000000000000000000000000000000000000ee";

let dbc: typeof productionDb;
let resetDb: () => Promise<void>;
let teardownDb: () => Promise<void>;

beforeAll(async () => {
  ({ dbc, reset: resetDb, teardown: teardownDb } = await createPgliteDb());
  setDbForTesting(dbc);
});

afterAll(async () => {
  setDbForTesting(null);
  await teardownDb();
});

// One PGlite per file, emptied between tests: an instance costs ~1.2-2GB
// resident that close() does not hand back, so one per test exhausts the
// allocator. reset() truncates the fixtures too, hence seeding here.
beforeEach(async () => {
  await resetDb();

  await dbc.insert(schema.contracts).values({
    address: "0x00000000000000000000000000000000000000cc",
    chainId: CHAIN_ID,
    name: "PregradManager",
  });

  // Distinct creation log indexes: markets_created_tx_log_idx is unique, so
  // two markets cannot share a (transaction, log index) origin.
  for (const [index, marketId] of [MARKET_ID, OTHER_MARKET_ID].entries()) {
    await dbc.insert(schema.markets).values({
      chainId: CHAIN_ID,
      collateral: "0x00000000000000000000000000000000000000dd",
      contractId: 1,
      createdBlockNumber: 99n,
      createdBlockTimestamp: new Date("2026-07-13T00:00:00Z"),
      createdLogIndex: index,
      createdTransactionHash: `0x${"33".repeat(32)}`,
      creator: "0x00000000000000000000000000000000000000aa",
      graduationThreshold: 1_000_000n,
      graduationTime: new Date("2026-08-01T00:00:00Z"),
      liquidityParameter: 1_000_000_000n,
      marketId,
      metadataHash: `0x${"22".repeat(32)}`,
      openingProbabilityWad: 500_000_000_000_000_000n,
      resolutionTime: new Date("2026-09-01T00:00:00Z"),
      status: "graduated",
    });
  }
});

describe("selectVenuePools against real SQL (PGlite)", () => {
  it("returns only the requested market's pools on the requested chain", async () => {
    await insertPool({ poolId: YES_POOL_ID, side: "yes" });
    await insertPool({
      outcomeIsCurrency0: false,
      poolId: NO_POOL_ID,
      side: "no",
    });
    await insertPool({
      marketId: OTHER_MARKET_ID,
      poolId: FOREIGN_POOL_ID,
      side: "yes",
    });
    await insertPool({
      chainId: OTHER_CHAIN_ID,
      poolId: `0x${"dd".repeat(32)}`,
      side: "yes",
    });

    const pools = await venuePriceHistoryReads.selectVenuePools({
      chainId: CHAIN_ID,
      marketId: MARKET_ID,
    });

    expect(pools.map((pool) => pool.poolId).sort()).toEqual(
      [NO_POOL_ID, YES_POOL_ID].sort(),
    );
    // The orientation flag drives every price conversion, so it must survive
    // the round trip per pool rather than defaulting.
    expect(pools.find((pool) => pool.side === "no")?.outcomeIsCurrency0).toBe(
      false,
    );
  });
});

describe("selectGraduatedAt against real SQL (PGlite)", () => {
  it("returns null before the market has a finalize row", async () => {
    expect(
      await venuePriceHistoryReads.selectGraduatedAt({
        chainId: CHAIN_ID,
        marketId: MARKET_ID,
      }),
    ).toBeNull();
  });

  it("takes the latest finalize when a market was re-finalized", async () => {
    await insertGraduation({
      blockNumber: 100n,
      blockTimestamp: new Date("2026-07-14T00:00:00Z"),
      logIndex: 0,
    });
    await insertGraduation({
      blockNumber: 105n,
      blockTimestamp: new Date("2026-07-15T00:00:00Z"),
      logIndex: 1,
      transactionHash: `0x${"55".repeat(32)}`,
    });

    const graduatedAt = await venuePriceHistoryReads.selectGraduatedAt({
      chainId: CHAIN_ID,
      marketId: MARKET_ID,
    });

    expect(graduatedAt?.toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });

  it("does not read another market's finalize row", async () => {
    await insertGraduation({
      blockNumber: 100n,
      blockTimestamp: new Date("2026-07-14T00:00:00Z"),
      logIndex: 0,
      marketId: OTHER_MARKET_ID,
    });

    expect(
      await venuePriceHistoryReads.selectGraduatedAt({
        chainId: CHAIN_ID,
        marketId: MARKET_ID,
      }),
    ).toBeNull();
  });
});

describe("selectPoolPriceTicks against real SQL (PGlite)", () => {
  it("orders ticks by block time then log index, not by insertion", async () => {
    // Inserted newest-first, and with the second block's two swaps reversed,
    // so an unordered query cannot pass by accident.
    await insertTick({
      blockNumber: 12n,
      blockTimestamp: new Date("2026-07-14T02:00:00Z"),
      logIndex: 5,
      tick: 300,
    });
    await insertTick({
      blockNumber: 11n,
      blockTimestamp: new Date("2026-07-14T01:00:00Z"),
      logIndex: 9,
      tick: 200,
    });
    await insertTick({
      blockNumber: 11n,
      blockTimestamp: new Date("2026-07-14T01:00:00Z"),
      logIndex: 2,
      tick: 100,
    });

    const ticks = await venuePriceHistoryReads.selectPoolPriceTicks({
      chainId: CHAIN_ID,
      poolIds: [YES_POOL_ID, NO_POOL_ID],
    });

    expect(ticks.map((row) => row.tick)).toEqual([100, 200, 300]);
  });

  it("returns ticks for every requested pool and no others", async () => {
    await insertTick({ logIndex: 0, poolId: YES_POOL_ID, tick: 10 });
    await insertTick({ logIndex: 1, poolId: NO_POOL_ID, tick: 20 });
    await insertTick({ logIndex: 2, poolId: FOREIGN_POOL_ID, tick: 30 });

    const ticks = await venuePriceHistoryReads.selectPoolPriceTicks({
      chainId: CHAIN_ID,
      poolIds: [YES_POOL_ID, NO_POOL_ID],
    });

    expect(ticks.map((row) => row.tick).sort((a, b) => a - b)).toEqual([
      10, 20,
    ]);
  });

  it("does not read another chain's ticks for the same pool id", async () => {
    await insertTick({ chainId: OTHER_CHAIN_ID, logIndex: 0, tick: 99 });

    expect(
      await venuePriceHistoryReads.selectPoolPriceTicks({
        chainId: CHAIN_ID,
        poolIds: [YES_POOL_ID],
      }),
    ).toEqual([]);
  });

  it("returns nothing for a market whose pools have never traded", async () => {
    expect(
      await venuePriceHistoryReads.selectPoolPriceTicks({
        chainId: CHAIN_ID,
        poolIds: [YES_POOL_ID, NO_POOL_ID],
      }),
    ).toEqual([]);
  });
});

async function insertPool(
  overrides: Partial<typeof schema.venuePools.$inferInsert>,
) {
  await dbc.insert(schema.venuePools).values({
    chainId: CHAIN_ID,
    marketId: MARKET_ID,
    outcomeIsCurrency0: true,
    outcomeToken: "0x00000000000000000000000000000000000000e0",
    poolId: YES_POOL_ID,
    postgradMarket: POSTGRAD_MARKET,
    side: "yes",
    ...overrides,
  });
}

async function insertGraduation(
  overrides: Partial<typeof schema.graduationFinalizedEvents.$inferInsert>,
) {
  await dbc.insert(schema.graduationFinalizedEvents).values({
    blockNumber: 100n,
    blockTimestamp: new Date("2026-07-14T00:00:00Z"),
    chainId: CHAIN_ID,
    completeSetCount: 2_500n * 10n ** 18n,
    contractId: 1,
    logIndex: 0,
    marketId: MARKET_ID,
    postgradAdapter: "0x00000000000000000000000000000000000000cd",
    postgradMarket: POSTGRAD_MARKET,
    refundTotal: 0n,
    retainedCostTotal: 2_400n * 10n ** 18n,
    transactionHash: `0x${"44".repeat(32)}`,
    ...overrides,
  });
}

async function insertTick(
  overrides: Partial<typeof schema.poolPriceTicks.$inferInsert>,
) {
  await dbc.insert(schema.poolPriceTicks).values({
    blockNumber: 100n,
    blockTimestamp: new Date("2026-07-14T01:00:00Z"),
    chainId: CHAIN_ID,
    contractId: 1,
    logIndex: 0,
    poolId: YES_POOL_ID,
    tick: 0,
    transactionHash: `0x${"66".repeat(32)}`,
    ...overrides,
  });
}
