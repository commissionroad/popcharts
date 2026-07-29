// Real-SQL tier for the dispute-window status projection: the guards are
// WHERE clauses, so only real SQL can show that a replayed or out-of-order log
// leaves markets.status alone. Covers the widened terminal guard too — a
// market that went through a proposal must still project resolved/cancelled.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";

import { count, eq } from "drizzle-orm";

import * as schema from "src/db/schema";
import type { db as productionDb } from "src/db/client";
import { createPgliteDb } from "src/test-support/pglite-db";
import {
  persistPostgradDisputeRecord,
  type PostgradDisputeRecord,
} from "src/indexer/handlers/postgrad-dispute";
import {
  persistPostgradDisputeBondRecord,
  type PostgradDisputeBondRecord,
} from "src/indexer/handlers/postgrad-dispute-bond";
import {
  persistPostgradResolutionRecord,
  type PostgradResolutionRecord,
} from "src/indexer/handlers/postgrad-resolution";
import type { MarketStatus } from "src/db/schema/markets";

const CHAIN_ID = 31337;
const MARKET_ID = 7n;
const POSTGRAD_MARKET = "0x00000000000000000000000000000000000000ee";
const DISPUTER = "0x00000000000000000000000000000000000000ab";

let dbc: typeof productionDb;
let resetDb: () => Promise<void>;
let teardownDb: () => Promise<void>;

function disputeRecord(
  overrides: Partial<PostgradDisputeRecord["event"]> = {},
): PostgradDisputeRecord {
  return {
    event: {
      blockNumber: 100n,
      blockTimestamp: new Date("2026-07-14T00:00:00Z"),
      chainId: CHAIN_ID,
      contractId: 1,
      disputeDeadline: new Date("2026-07-15T00:00:00Z"),
      disputer: null,
      kind: "proposed",
      logIndex: 3,
      marketId: MARKET_ID,
      postgradMarket: POSTGRAD_MARKET,
      proposedSide: "yes",
      transactionHash: `0x${"11".repeat(32)}`,
      ...overrides,
    },
  };
}

function disputedRecord(): PostgradDisputeRecord {
  return disputeRecord({
    disputeDeadline: null,
    disputer: DISPUTER,
    kind: "disputed",
    logIndex: 4,
    proposedSide: null,
    transactionHash: `0x${"22".repeat(32)}`,
  });
}

function resolutionRecord(): PostgradResolutionRecord {
  return {
    event: {
      blockNumber: 102n,
      blockTimestamp: new Date("2026-07-16T00:00:00Z"),
      chainId: CHAIN_ID,
      contractId: 1,
      kind: "resolved",
      logIndex: 5,
      marketId: MARKET_ID,
      postgradMarket: POSTGRAD_MARKET,
      transactionHash: `0x${"33".repeat(32)}`,
      winningSide: "yes",
    },
  };
}

async function marketStatus(): Promise<MarketStatus> {
  const [row] = await dbc
    .select({ status: schema.markets.status })
    .from(schema.markets)
    .where(eq(schema.markets.marketId, MARKET_ID));
  return row!.status;
}

async function setMarketStatus(status: MarketStatus) {
  await dbc
    .update(schema.markets)
    .set({ status })
    .where(eq(schema.markets.marketId, MARKET_ID));
}

beforeAll(async () => {
  ({ dbc, reset: resetDb, teardown: teardownDb } = await createPgliteDb());
});

afterAll(async () => {
  await teardownDb();
});

// One instance per file, emptied between tests: a PGlite costs ~1.2-2GB
// resident that close() does not hand back, so booting one per test runs the
// allocator out of room. reset() also beats a hand-listed set of deletes,
// which silently stops covering a table the moment one is added. It truncates
// the fixture rows too, so they are seeded here rather than once in beforeAll.
beforeEach(async () => {
  await resetDb();

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
    status: "graduated",
  });
});

function bondRecord(): PostgradDisputeBondRecord {
  return {
    event: {
      amount: 100_000_000n,
      blockNumber: 101n,
      blockTimestamp: new Date("2026-07-15T00:00:00Z"),
      chainId: CHAIN_ID,
      contractId: 1,
      disputer: DISPUTER,
      kind: "posted",
      logIndex: 6,
      marketId: MARKET_ID,
      postgradMarket: POSTGRAD_MARKET,
      transactionHash: `0x${"44".repeat(32)}`,
    },
  };
}

describe("persistPostgradDisputeRecord against real SQL (PGlite)", () => {
  it("moves a graduated market into resolution_pending and signals the feed", async () => {
    await persistPostgradDisputeRecord(disputeRecord(), dbc);

    expect(await marketStatus()).toBe("resolution_pending");
    const [signal] = await dbc
      .select({ sourceTable: schema.changeFeed.sourceTable })
      .from(schema.changeFeed);
    expect(signal?.sourceTable).toBe("postgrad_dispute_events");
  });

  it("moves a pending market into disputed", async () => {
    await persistPostgradDisputeRecord(disputeRecord(), dbc);
    await persistPostgradDisputeRecord(disputedRecord(), dbc);

    expect(await marketStatus()).toBe("disputed");
  });

  it("dedups a replayed log and leaves the status where it is", async () => {
    await persistPostgradDisputeRecord(disputeRecord(), dbc);
    await persistPostgradDisputeRecord(disputedRecord(), dbc);
    await persistPostgradDisputeRecord(disputeRecord(), dbc);

    expect(await marketStatus()).toBe("disputed");
    const [events] = await dbc
      .select({ value: count() })
      .from(schema.postgradDisputeEvents);
    expect(events!.value).toBe(2);
    // The replay must not signal again either, or the UI refetches for nothing.
    const [signals] = await dbc
      .select({ value: count() })
      .from(schema.changeFeed);
    expect(signals!.value).toBe(2);
  });

  it("projects a dispute that arrives before its own proposal", async () => {
    // A recovery sweep racing the live subscription can deliver these two out
    // of order. `disputed` accepts `graduated` because the dispute log implies
    // the proposal, so the market must not sit on a countdown that will never
    // finalize. Do not tidy the guard back to a single predecessor status.
    await persistPostgradDisputeRecord(disputedRecord(), dbc);
    expect(await marketStatus()).toBe("disputed");

    await persistPostgradDisputeRecord(disputeRecord(), dbc);

    // The late proposal matches none of its own predecessors and no-ops.
    expect(await marketStatus()).toBe("disputed");
  });

  it("never drags a resolved market back into the dispute window", async () => {
    await setMarketStatus("resolved");

    // Neither kind may reopen a terminal market — the widened `disputed`
    // predecessor set adds `graduated`, not the terminal statuses.
    await persistPostgradDisputeRecord(disputeRecord(), dbc);
    expect(await marketStatus()).toBe("resolved");

    await persistPostgradDisputeRecord(disputedRecord(), dbc);
    expect(await marketStatus()).toBe("resolved");
  });

  it("does not skip the proposal guard when the market is still bootstrapping", async () => {
    await setMarketStatus("bootstrap");

    await persistPostgradDisputeRecord(disputeRecord(), dbc);

    expect(await marketStatus()).toBe("bootstrap");
  });
});

describe("persistPostgradDisputeBondRecord against real SQL (PGlite)", () => {
  it("signals the market once per bond movement and never touches the status", async () => {
    await persistPostgradDisputeBondRecord(bondRecord(), dbc);
    await persistPostgradDisputeBondRecord(bondRecord(), dbc);

    const [rows] = await dbc
      .select({ value: count() })
      .from(schema.postgradDisputeBondEvents);
    expect(rows!.value).toBe(1);
    const signals = await dbc
      .select({ sourceTable: schema.changeFeed.sourceTable })
      .from(schema.changeFeed);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.sourceTable).toBe("postgrad_dispute_bond_events");
    // Money rows are a paper trail, not a lifecycle signal.
    expect(await marketStatus()).toBe("graduated");
  });
});

describe("persistPostgradResolutionRecord terminal guard (PGlite)", () => {
  it("resolves a market that is sitting in resolution_pending", async () => {
    await persistPostgradDisputeRecord(disputeRecord(), dbc);

    await persistPostgradResolutionRecord(resolutionRecord(), dbc);

    expect(await marketStatus()).toBe("resolved");
  });

  it("resolves a market an operator settled out of disputed", async () => {
    await persistPostgradDisputeRecord(disputeRecord(), dbc);
    await persistPostgradDisputeRecord(disputedRecord(), dbc);

    await persistPostgradResolutionRecord(resolutionRecord(), dbc);

    expect(await marketStatus()).toBe("resolved");
  });

  it("still resolves the legacy direct path from graduated", async () => {
    await persistPostgradResolutionRecord(resolutionRecord(), dbc);

    expect(await marketStatus()).toBe("resolved");
  });

  it("leaves a market that never graduated alone", async () => {
    await setMarketStatus("bootstrap");

    await persistPostgradResolutionRecord(resolutionRecord(), dbc);

    expect(await marketStatus()).toBe("bootstrap");
  });
});
