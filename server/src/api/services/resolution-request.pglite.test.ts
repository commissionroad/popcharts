// Real-SQL cover for the public resolution-check endpoint's "already
// evaluated" branch. After ADR 0026 that branch must count confirmed rows only:
// a pending row is a verdict in flight, not an evaluation anyone should be told
// about, and treating it as one would refuse a re-check on a market whose
// proposal never reached the chain.
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

import { requestMarketResolutionCheck } from "./resolution-request";

const CHAIN_ID = 31337;
const MARKET_ID = 7n;
const METADATA_HASH = `0x${"22".repeat(32)}`;
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
    question: "Is a pending row an evaluation?",
    resolutionCriteria: "Resolves YES when it is not.",
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

async function request() {
  return await requestMarketResolutionCheck(
    { chainId: CHAIN_ID, marketId: MARKET_ID.toString() },
    { now: NOW },
  );
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

describe("requestMarketResolutionCheck", () => {
  it("queues a check for a graduated market with no resolution", async () => {
    expect((await request()).kind).toBe("queued");
  });

  it("reports already_evaluated once a resolution is confirmed", async () => {
    await dbc
      .insert(schema.marketResolutions)
      .values(resolutionRow("confirmed"));

    expect((await request()).kind).toBe("already_evaluated");
  });

  // A pending row means the runner is mid-flight, not that the market has been
  // evaluated. The job it belongs to is the accurate answer, and the caller
  // gets it from the branch below instead.
  it("does not treat a pending row as an evaluation", async () => {
    await dbc.insert(schema.marketResolutions).values(resolutionRow("pending"));
    await dbc.insert(schema.marketResolutionJobs).values({
      chainId: CHAIN_ID,
      marketId: MARKET_ID,
      metadataHash: METADATA_HASH,
      status: "running",
    });

    expect((await request()).kind).toBe("already_queued");
  });

  // The case that matters: the proposal never landed and the job is dead. The
  // market genuinely needs re-checking, and counting the pending row would
  // refuse it forever.
  it("re-queues a market whose pending row was left by a dead job", async () => {
    await dbc.insert(schema.marketResolutions).values(resolutionRow("pending"));
    await dbc.insert(schema.marketResolutionJobs).values({
      chainId: CHAIN_ID,
      // Older than the 24h cooldown, so only the resolution row could block it.
      createdAt: new Date("2026-07-04T00:00:00.000Z"),
      marketId: MARKET_ID,
      metadataHash: METADATA_HASH,
      status: "terminal_failed",
    });

    expect((await request()).kind).toBe("queued");
  });
});
