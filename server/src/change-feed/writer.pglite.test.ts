// Behavioural contract of recordLiveChange (repo ADR 0021): it appends one
// routable change_feed row, and — because it runs in the caller's transaction —
// a rolled-back write leaves no signal behind.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { db as productionDb } from "src/db/client";
import * as schema from "src/db/schema";
import { recordLiveChange } from "src/change-feed/writer";
import { createPgliteDb } from "src/test-support/pglite-db";

let dbc: typeof productionDb;
let teardownDb: () => Promise<void>;

beforeEach(async () => {
  ({ dbc, teardown: teardownDb } = await createPgliteDb());
});

afterEach(async () => {
  await teardownDb();
});

describe("recordLiveChange", () => {
  it("appends one change_feed row, normalizing ids to the routing columns", async () => {
    await recordLiveChange(dbc, {
      sourceTable: "receipt_placed_events",
      op: "insert",
      chainId: 31337,
      marketId: 42n,
      owner: "0x00000000000000000000000000000000000000aa",
      rowId: 7n,
      blockNumber: 100n,
      logIndex: 3,
    });

    const rows = await dbc.select().from(schema.changeFeed);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceTable: "receipt_placed_events",
      op: "insert",
      chainId: 31337,
      marketId: "42",
      owner: "0x00000000000000000000000000000000000000aa",
      rowId: "7",
      blockNumber: 100n,
      logIndex: 3,
    });
  });

  it("rolls back with its transaction, so a signal never outlives a reverted write", async () => {
    await expect(
      dbc.transaction(async (tx) => {
        await recordLiveChange(tx, {
          sourceTable: "market_cancelled_events",
          op: "insert",
          chainId: 31337,
          marketId: 42n,
        });
        throw new Error("write reverted");
      }),
    ).rejects.toThrow("write reverted");

    const rows = await dbc.select().from(schema.changeFeed);
    expect(rows).toHaveLength(0);
  });

  it("leaves marketId/owner null when a source does not route them", async () => {
    await recordLiveChange(dbc, {
      sourceTable: "market_resolutions",
      op: "insert",
      chainId: 31337,
      marketId: 42n,
    });

    const [signalRow] = await dbc.select().from(schema.changeFeed);
    expect(signalRow?.owner).toBeNull();
    expect(signalRow?.blockNumber).toBeNull();
  });
});
