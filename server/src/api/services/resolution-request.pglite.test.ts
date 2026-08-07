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
import {
  RESOLUTION_FIXTURE,
  resolutionRowValues,
  seedResolutionMarket,
} from "src/test-support/resolution-fixtures";

import { requestMarketResolutionCheck } from "./resolution-request";

const {
  chainId: CHAIN_ID,
  marketId: MARKET_ID,
  metadataHash: METADATA_HASH,
} = RESOLUTION_FIXTURE;
const NOW = new Date("2026-07-20T00:00:00.000Z");

let dbc: typeof productionDb;
let resetDb: () => Promise<void>;
let teardownDb: () => Promise<void>;

const resolutionRow = (commitState: "confirmed" | "pending") =>
  resolutionRowValues({ commitState });

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
  await seedResolutionMarket(dbc);
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
