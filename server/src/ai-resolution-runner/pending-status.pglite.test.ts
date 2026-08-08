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
import {
  RESOLUTION_FIXTURE,
  resolutionRowValues,
  seedResolutionMarket,
} from "src/test-support/resolution-fixtures";

import { collectPendingRows, formatAge } from "./pending-status";

const {
  chainId: CHAIN_ID,
  marketId: MARKET_ID,
  metadataHash: METADATA_HASH,
} = RESOLUTION_FIXTURE;
const NOW = new Date("2026-07-20T12:00:00.000Z");

let dbc: typeof productionDb;
let resetDb: () => Promise<void>;
let teardownDb: () => Promise<void>;

async function seedResolution(commitState: "confirmed" | "pending") {
  const [row] = await dbc
    .insert(schema.marketResolutions)
    .values(
      resolutionRowValues({
        commitState,
        createdAt: new Date("2026-07-20T10:00:00.000Z"),
      }),
    )
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
  await seedResolutionMarket(dbc, { status: "resolution_pending" });
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
      question: RESOLUTION_FIXTURE.question,
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
