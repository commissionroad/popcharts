// Real-SQL cover for the operator pending-row lens: two left joins and a
// commit-state filter are exactly the things a unit test cannot exercise.
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

import { collectPendingRows, formatAge } from "./pending-status";

const CHAIN_ID = 31337;
const MARKET_ID = 7n;
const METADATA_HASH = `0x${"22".repeat(32)}`;
const NOW = new Date("2026-07-20T12:00:00.000Z");

let dbc: typeof productionDb;
let resetDb: () => Promise<void>;
let teardownDb: () => Promise<void>;

async function seedMarket() {
  await dbc.insert(schema.contracts).values({
    address: "0x00000000000000000000000000000000000000cc",
    chainId: CHAIN_ID,
    name: "PregradManager",
  });
  await dbc.insert(schema.marketMetadata).values({
    category: "Testing",
    chainId: CHAIN_ID,
    description: "A market with a judgment in flight.",
    metadataCreatedAt: "2026-07-01T00:00:00.000Z",
    metadataHash: METADATA_HASH,
    question: "Does the operator lens see the pending row?",
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
    resolutionTime: new Date("2026-07-03T00:00:00.000Z"),
    status: "resolution_pending",
  });
}

async function seedResolution(commitState: "confirmed" | "pending") {
  const [row] = await dbc
    .insert(schema.marketResolutions)
    .values({
      chainId: CHAIN_ID,
      commitState,
      createdAt: new Date("2026-07-20T10:00:00.000Z"),
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
    })
    .returning();
  return row!;
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
  await seedMarket();
});

describe("collectPendingRows", () => {
  it("reports a pending row with its age, question, and owning job", async () => {
    const resolution = await seedResolution("pending");
    await dbc.insert(schema.marketResolutionJobs).values({
      attemptCount: 2,
      chainId: CHAIN_ID,
      lastError: "RPC unreachable",
      marketId: MARKET_ID,
      maxAttempts: 5,
      metadataHash: METADATA_HASH,
      resolutionId: resolution.id,
      status: "retryable_failed",
    });

    const rows = await collectPendingRows(NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      // 10:00 → 12:00 on the same day.
      ageMs: 2 * 60 * 60 * 1000,
      chainId: CHAIN_ID,
      jobAttempts: "2/5",
      jobLastError: "RPC unreachable",
      jobStatus: "retryable_failed",
      marketId: "7",
      question: "Does the operator lens see the pending row?",
      verdict: "resolve_yes",
    });
  });

  it("reports a pending row no job references, with null job fields", async () => {
    await seedResolution("pending");

    const rows = await collectPendingRows(NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      jobAttempts: null,
      jobLastError: null,
      jobStatus: null,
    });
  });

  it("excludes confirmed rows — the lens is only for judgments in flight", async () => {
    await seedResolution("confirmed");

    expect(await collectPendingRows(NOW)).toHaveLength(0);
  });
});

describe("formatAge", () => {
  it("renders each magnitude with its two leading units", () => {
    expect(formatAge(42_000)).toBe("42s");
    expect(formatAge(8_040_000)).toBe("2h 14m");
    expect(formatAge(93_784_000)).toBe("1d 2h");
    expect(formatAge(150_000)).toBe("2m 30s");
  });

  it("clamps a negative age to zero rather than rendering nonsense", () => {
    expect(formatAge(-5_000)).toBe("0s");
  });
});
