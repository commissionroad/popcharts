// Real-SQL cover for the ADR 0026 commit-state schema. The partial unique index
// is a WHERE clause, so only real Postgres can show that it constrains pending
// rows and leaves confirmed history alone — and the runner's retry path is going
// to depend on exactly that.
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
import * as schema from "src/db/schema";
import { createPgliteDb } from "src/test-support/pglite-db";

const CHAIN_ID = 31337;
const MARKET_ID = 7n;
const METADATA_HASH = `0x${"22".repeat(32)}`;

let dbc: typeof productionDb;
let resetDb: () => Promise<void>;
let teardownDb: () => Promise<void>;

function resolutionRow(
  overrides: Partial<typeof schema.marketResolutions.$inferInsert> = {},
) {
  return {
    chainId: CHAIN_ID,
    evidence: [],
    hardFlags: [],
    marketId: MARKET_ID,
    metadataHash: METADATA_HASH,
    outcome: "yes" as const,
    promptVersion: "v1",
    provider: "anthropic" as const,
    reasons: ["Because."],
    sourceChecks: [],
    verdict: "resolve_yes" as const,
    ...overrides,
  };
}

async function seedMarket() {
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
    question: "Does the partial index hold?",
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
    status: "graduated",
  });
}

beforeAll(async () => {
  ({ dbc, reset: resetDb, teardown: teardownDb } = await createPgliteDb());
});

afterAll(async () => {
  await teardownDb();
});

beforeEach(async () => {
  await resetDb();
  await seedMarket();
});

describe("market_resolutions commit_state", () => {
  it("defaults to confirmed, so a writer that ignores it keeps today's meaning", async () => {
    const [row] = await dbc
      .insert(schema.marketResolutions)
      .values(resolutionRow())
      .returning();

    expect(row?.commitState).toBe("confirmed");
  });

  it("leaves resolved_at null until something confirms the row", async () => {
    const [row] = await dbc
      .insert(schema.marketResolutions)
      .values(resolutionRow({ commitState: "pending" }))
      .returning();

    // The block timestamp does not exist yet. Inventing one is the inference
    // the money paper-trail invariant forbids.
    expect(row?.resolvedAt).toBeNull();
  });

  it("accepts a resolved_at once the row is confirmed", async () => {
    const resolvedAt = new Date("2026-07-04T00:00:00.000Z");
    const [row] = await dbc
      .insert(schema.marketResolutions)
      .values(resolutionRow({ commitState: "confirmed", resolvedAt }))
      .returning();

    expect(row?.resolvedAt).toEqual(resolvedAt);
  });
});

describe("market_resolutions pending unique index", () => {
  // The runner's retry adopts the pending row its earlier attempt wrote. That
  // only works if a second one cannot exist.
  it("rejects a second pending row for the same metadata version", async () => {
    // Wrapped in an async function deliberately: drizzle's insert builder is a
    // thenable, not a Promise, and `expect(builder).rejects` inspects the
    // builder instead of awaiting it — the assertion passes on nothing.
    const insertPending = async () =>
      await dbc
        .insert(schema.marketResolutions)
        .values(resolutionRow({ commitState: "pending" }));

    await insertPending();

    await expect(insertPending()).rejects.toThrow(
      /duplicate key value violates unique constraint "market_resolutions_pending_unique_idx"/,
    );
  });

  it("allows a pending row once an earlier one has been confirmed", async () => {
    const [first] = await dbc
      .insert(schema.marketResolutions)
      .values(resolutionRow({ commitState: "pending" }))
      .returning();
    await dbc
      .update(schema.marketResolutions)
      .set({ commitState: "confirmed" })
      .where(eq(schema.marketResolutions.id, first?.id ?? -1));

    await dbc
      .insert(schema.marketResolutions)
      .values(resolutionRow({ commitState: "pending" }));

    expect(await dbc.select().from(schema.marketResolutions)).toHaveLength(2);
  });

  // Confirmed rows are deliberately unconstrained: an operator override or a
  // creator self-resolve can legitimately add to a market's history.
  it("does not constrain confirmed rows", async () => {
    await dbc
      .insert(schema.marketResolutions)
      .values(resolutionRow({ commitState: "confirmed" }));
    await dbc
      .insert(schema.marketResolutions)
      .values(resolutionRow({ commitState: "confirmed", provider: "manual" }));

    expect(await dbc.select().from(schema.marketResolutions)).toHaveLength(2);
  });
});
