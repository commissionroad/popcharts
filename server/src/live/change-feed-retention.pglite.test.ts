// Behavioural contract of pruneChangeFeed (repo ADR 0021): it deletes only rows
// strictly older than the retention horizon, drains a backlog across batches,
// and reports how many it removed.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { db as productionDb } from "src/db/client";
import * as schema from "src/db/schema";
import { pruneChangeFeed } from "src/live/change-feed-retention";
import { createPgliteDb } from "src/test-support/pglite-db";

let dbc: typeof productionDb;
let teardownDb: () => Promise<void>;

beforeEach(async () => {
  ({ dbc, teardown: teardownDb } = await createPgliteDb());
});

afterEach(async () => {
  await teardownDb();
});

const CUTOFF = new Date("2026-07-20T00:00:00.000Z");

function signalAt(createdAt: Date): typeof schema.changeFeed.$inferInsert {
  return { sourceTable: "receipt_placed_events", op: "insert", createdAt };
}

describe("pruneChangeFeed", () => {
  it("deletes only rows older than the cutoff (strict) and returns the count", async () => {
    await dbc.insert(schema.changeFeed).values([
      signalAt(new Date("2026-07-18T00:00:00.000Z")), // older → deleted
      signalAt(new Date("2026-07-19T23:59:59.000Z")), // older → deleted
      signalAt(CUTOFF), // exactly at horizon → kept (lt is strict)
      signalAt(new Date("2026-07-21T00:00:00.000Z")), // newer → kept
    ]);

    const deleted = await pruneChangeFeed(dbc, { olderThan: CUTOFF });

    expect(deleted).toBe(2);
    const remaining = await dbc.select().from(schema.changeFeed);
    expect(remaining).toHaveLength(2);
    expect(remaining.every((row) => row.createdAt >= CUTOFF)).toBe(true);
  });

  it("drains a backlog larger than one batch", async () => {
    const old = new Date("2026-07-18T00:00:00.000Z");
    await dbc
      .insert(schema.changeFeed)
      .values(Array.from({ length: 5 }, () => signalAt(old)));

    const deleted = await pruneChangeFeed(dbc, {
      olderThan: CUTOFF,
      batchSize: 2,
    });

    expect(deleted).toBe(5);
    expect(await dbc.select().from(schema.changeFeed)).toHaveLength(0);
  });

  it("returns 0 when nothing is old enough", async () => {
    await dbc
      .insert(schema.changeFeed)
      .values([signalAt(new Date("2026-07-21T00:00:00.000Z"))]);

    expect(await pruneChangeFeed(dbc, { olderThan: CUTOFF })).toBe(0);
    expect(await dbc.select().from(schema.changeFeed)).toHaveLength(1);
  });
});
