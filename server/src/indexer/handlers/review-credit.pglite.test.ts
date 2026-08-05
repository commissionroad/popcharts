// Real-SQL tier for the review-bond paper trail: the dedupe is a unique index
// on (chain, tx, log), so only real SQL can show that a replayed log is a
// no-op rather than a duplicate value transfer.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";

import { count } from "drizzle-orm";

import * as schema from "src/db/schema";
import type { db as productionDb } from "src/db/client";
import { createPgliteDb } from "src/test-support/pglite-db";
import {
  persistReviewCreditRecord,
  type ReviewCreditRecord,
} from "src/indexer/handlers/review-credit";

const CHAIN_ID = 31337;
const USER = "0x00000000000000000000000000000000000000ab";

let dbc: typeof productionDb;
let resetDb: () => Promise<void>;
let teardownDb: () => Promise<void>;

beforeAll(async () => {
  ({ dbc, reset: resetDb, teardown: teardownDb } = await createPgliteDb());
});

afterAll(async () => {
  await teardownDb();
});

// One instance per file, emptied between tests: a PGlite costs ~1.2-2GB
// resident that close() does not hand back, so booting one per test runs the
// allocator out of room. reset() truncates the fixture rows too, so they are
// seeded here rather than once in beforeAll.
beforeEach(async () => {
  await resetDb();

  await dbc.insert(schema.contracts).values({
    address: "0x00000000000000000000000000000000000000cc",
    chainId: CHAIN_ID,
    name: "ReviewCreditVault",
  });
});

function record(
  overrides: Partial<ReviewCreditRecord["event"]> = {},
): ReviewCreditRecord {
  return {
    event: {
      account: USER,
      amount: 5_000_000n,
      blockNumber: 100n,
      blockTimestamp: new Date("2026-07-30T00:00:00Z"),
      chainId: CHAIN_ID,
      contractId: 1,
      kind: "deposited",
      logIndex: 3,
      runningTotal: 5_000_000n,
      transactionHash: `0x${"11".repeat(32)}`,
      ...overrides,
    },
  };
}

describe("persistReviewCreditRecord against real SQL (PGlite)", () => {
  it("dedups a replayed log on (chain, tx, log) so a sweep replay never double-counts", async () => {
    await persistReviewCreditRecord(record(), dbc);
    await persistReviewCreditRecord(record(), dbc);

    const [rows] = await dbc
      .select({ value: count() })
      .from(schema.reviewCreditEvents);
    expect(rows!.value).toBe(1);
  });

  it("keeps all four kinds as distinct rows of one vault history", async () => {
    await persistReviewCreditRecord(record(), dbc);
    await persistReviewCreditRecord(
      record({ kind: "settled", logIndex: 4, runningTotal: 1_000_000n }),
      dbc,
    );
    await persistReviewCreditRecord(
      record({ kind: "bond_withdrawn", logIndex: 5, runningTotal: 0n }),
      dbc,
    );
    await persistReviewCreditRecord(
      record({ kind: "fees_withdrawn", logIndex: 6, runningTotal: null }),
      dbc,
    );

    const rows = await dbc
      .select({
        kind: schema.reviewCreditEvents.kind,
        runningTotal: schema.reviewCreditEvents.runningTotal,
      })
      .from(schema.reviewCreditEvents)
      .orderBy(schema.reviewCreditEvents.logIndex);

    expect(rows.map((row) => row.kind)).toEqual([
      "deposited",
      "settled",
      "bond_withdrawn",
      "fees_withdrawn",
    ]);
    // The sweep row's missing cumulative survives the uint256 column as null,
    // not zero — 0 is a real total, absent is not.
    expect(rows.map((row) => row.runningTotal)).toEqual([
      5_000_000n,
      1_000_000n,
      0n,
      null,
    ]);
  });
});
