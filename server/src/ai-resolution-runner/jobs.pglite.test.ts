// Real-SQL cover for the enqueue guard. `noResolutionForCurrentMarket()` is a
// correlated `not exists` fragment, so only real SQL can show which rows it
// counts — and after ADR 0026 that distinction is what keeps a market whose
// proposal never landed from falling out of the system permanently.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";

import { eq } from "drizzle-orm";

import type { db as productionDb } from "src/db/client";
import { setDbForTesting } from "src/db/client";
import * as schema from "src/db/schema";
import { createPgliteDb } from "src/test-support/pglite-db";

import { enqueueEligibleMarketResolutionJobs } from "./jobs";

const CHAIN_ID = 31337;
const MARKET_ID = 7n;
const METADATA_HASH = `0x${"22".repeat(32)}`;
// Both resolution gates sit in the past, so the market is enqueue-eligible.
const RESOLUTION_TIME = new Date("2026-07-03T00:00:00.000Z");
const NOW = new Date("2026-07-20T00:00:00.000Z");

let dbc: typeof productionDb;
let resetDb: () => Promise<void>;
let teardownDb: () => Promise<void>;

function resolutionRow(
  commitState: "confirmed" | "pending",
): typeof schema.marketResolutions.$inferInsert {
  return {
    chainId: CHAIN_ID,
    commitState,
    evidence: [],
    hardFlags: [],
    marketId: MARKET_ID,
    metadataHash: METADATA_HASH,
    outcome: "yes",
    promptVersion: "v1",
    provider: "anthropic",
    reasons: ["Because."],
    sourceChecks: [],
    verdict: "resolve_yes",
  };
}

async function seedGraduatedMarket() {
  await dbc.insert(schema.contracts).values({
    address: "0x00000000000000000000000000000000000000cc",
    chainId: CHAIN_ID,
    name: "PregradManager",
  });
  await dbc.insert(schema.marketMetadata).values({
    category: "Testing",
    chainId: CHAIN_ID,
    description: "A graduated market awaiting resolution.",
    metadataCreatedAt: "2026-07-01T00:00:00.000Z",
    metadataHash: METADATA_HASH,
    question: "Does the enqueue guard count only confirmed rows?",
    resolutionCriteria: "Resolves YES when it does.",
  });
  await dbc.insert(schema.markets).values({
    chainId: CHAIN_ID,
    collateral: "0x00000000000000000000000000000000000000dd",
    contractId: 1,
    createdBlockNumber: 99n,
    createdBlockTimestamp: new Date("2026-07-01T00:00:00.000Z"),
    createdLogIndex: 0,
    createdTransactionHash: `0x${"33".repeat(32)}`,
    creator: "0x00000000000000000000000000000000000000aa",
    graduationThreshold: 1_000_000n,
    graduationTime: new Date("2026-07-02T00:00:00.000Z"),
    liquidityParameter: 1_000_000_000n,
    marketId: MARKET_ID,
    metadataHash: METADATA_HASH,
    openingProbabilityWad: 500_000_000_000_000_000n,
    resolutionTime: RESOLUTION_TIME,
    status: "graduated",
  });
}

async function enqueue() {
  return await enqueueEligibleMarketResolutionJobs({
    limit: 10,
    maxAttempts: 5,
    now: NOW,
  });
}

beforeAll(async () => {
  ({ dbc, reset: resetDb, teardown: teardownDb } = await createPgliteDb());
  setDbForTesting(dbc);
});

afterAll(async () => {
  setDbForTesting(null);
  await teardownDb();
});

beforeEach(async () => {
  await resetDb();
  await seedGraduatedMarket();
});

describe("enqueueEligibleMarketResolutionJobs", () => {
  it("enqueues a graduated market past its resolution gate", async () => {
    expect(await enqueue()).toHaveLength(1);
  });

  it("skips a market whose resolution is confirmed", async () => {
    await dbc
      .insert(schema.marketResolutions)
      .values(resolutionRow("confirmed"));

    expect(await enqueue()).toHaveLength(0);
  });

  // The reason this guard exists. The runner writes its judgment `pending`
  // before proposing, so an unqualified existence check would read that row as
  // "already resolved" and drop the market out of enqueue for good — even
  // though the proposal may never have reached the chain.
  it("still enqueues a market whose only row is pending", async () => {
    await dbc.insert(schema.marketResolutions).values(resolutionRow("pending"));

    expect(await enqueue()).toHaveLength(1);
  });

  it("skips once a pending row is confirmed", async () => {
    const [row] = await dbc
      .insert(schema.marketResolutions)
      .values(resolutionRow("pending"))
      .returning();
    expect(await enqueue()).toHaveLength(1);

    // Clear the job the first pass created; the active-job guard would
    // otherwise mask what this test is actually about.
    await dbc.delete(schema.marketResolutionJobs);
    await dbc
      .update(schema.marketResolutions)
      .set({ commitState: "confirmed" })
      .where(eq(schema.marketResolutions.id, row?.id ?? -1));

    expect(await enqueue()).toHaveLength(0);
  });
});
