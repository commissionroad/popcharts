// Exercises the relay's tail semantics in isolation (repo ADR 0021) by writing
// change_feed rows directly with chosen ids — no trigger needed — so ordering,
// dedup, frontier-snapshot, sequence-gap recovery, and replay can each be
// asserted deterministically.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { db as productionDb } from "src/db/client";
import * as schema from "src/db/schema";
import { ChangeFeedHub } from "src/change-feed/hub";
import { ChangeFeedRelay, replayChangeFeedEvents } from "src/change-feed/relay";
import type { ChangeFeedEvent } from "src/change-feed/sources";
import { createPgliteDb } from "src/test-support/pglite-db";

const CHAIN_ID = 31337;
const MARKET_CHANNEL = "market:31337:42";

let dbc: typeof productionDb;
let teardownDb: () => Promise<void>;

beforeEach(async () => {
  ({ dbc, teardown: teardownDb } = await createPgliteDb());
});

afterEach(async () => {
  await teardownDb();
});

/** Writes a change_feed row directly with an explicit id, defaulting to a
 * market_cancelled_events shape (routes to market + market-list channels). */
async function feed(
  id: number,
  overrides: Partial<typeof schema.changeFeed.$inferInsert> = {},
) {
  await dbc.insert(schema.changeFeed).values({
    id: BigInt(id),
    sourceTable: "market_cancelled_events",
    op: "insert",
    chainId: CHAIN_ID,
    marketId: "42",
    ...overrides,
  });
}

function collectingRelay() {
  const events: ChangeFeedEvent[] = [];
  const hub = new ChangeFeedHub();
  hub.subscribe(["markets", MARKET_CHANNEL], (event) => events.push(event));
  const relay = new ChangeFeedRelay({ db: dbc, hub });
  return { events, relay, ids: () => events.map((e) => Number(e.id)) };
}

describe("ChangeFeedRelay", () => {
  it("publishes new rows to the hub in id order", async () => {
    const { relay, ids } = collectingRelay();
    await relay.start();

    await feed(1);
    await feed(3);
    await feed(2);
    await relay.poll();

    expect(ids()).toEqual([1, 2, 3]);
    relay.stop();
  });

  it("snapshots the frontier at start so pre-existing rows are not replayed live", async () => {
    await feed(1);
    await feed(2);

    const { relay, ids } = collectingRelay();
    await relay.start();
    await relay.poll();
    expect(ids()).toEqual([]);

    await feed(3);
    await relay.poll();
    expect(ids()).toEqual([3]);
    relay.stop();
  });

  it("does not re-publish a row across polls", async () => {
    const { relay, ids } = collectingRelay();
    await relay.start();

    await feed(1);
    await relay.poll();
    await relay.poll();

    expect(ids()).toEqual([1]);
    relay.stop();
  });

  it("recovers a lower id that becomes visible after a higher id (sequence gap)", async () => {
    const { relay, ids } = collectingRelay();
    await relay.start();

    await feed(5);
    await relay.poll();
    expect(ids()).toEqual([5]);

    // id 3 was in-flight when 5 was read; it commits after and must still ship.
    await feed(3);
    await relay.poll();
    expect(ids()).toEqual([5, 3]);
    relay.stop();
  });

  it("only delivers to subscribers whose channels intersect", async () => {
    const hub = new ChangeFeedHub();
    const marketEvents: ChangeFeedEvent[] = [];
    const otherEvents: ChangeFeedEvent[] = [];
    hub.subscribe([MARKET_CHANNEL], (e) => marketEvents.push(e));
    hub.subscribe(["market:31337:999"], (e) => otherEvents.push(e));

    const relay = new ChangeFeedRelay({ db: dbc, hub });
    await relay.start();
    await feed(1);
    await relay.poll();

    expect(marketEvents).toHaveLength(1);
    expect(otherEvents).toHaveLength(0);
    relay.stop();
  });

  describe("replayChangeFeedEvents", () => {
    it("returns mapped events strictly after the cursor, in order", async () => {
      await feed(1);
      await feed(2, { marketId: "43" });
      await feed(3);

      const { events } = await replayChangeFeedEvents(dbc, 1n);
      expect(events.map((e) => Number(e.id))).toEqual([2, 3]);
      expect(events[0]!.channels).toContain("market:31337:43");
    });

    it("drops rows whose table is not a registered source", async () => {
      await feed(1);
      await feed(2, { sourceTable: "some_unwatched_table" });

      const { events } = await replayChangeFeedEvents(dbc, 0n);
      expect(events.map((e) => Number(e.id))).toEqual([1]);
    });

    it("flags truncation when the cap is hit", async () => {
      await feed(1);
      await feed(2);

      const capped = await replayChangeFeedEvents(dbc, 0n, 1);
      expect(capped.truncated).toBe(true);
      expect(capped.events.map((e) => Number(e.id))).toEqual([1]);

      const full = await replayChangeFeedEvents(dbc, 0n, 10);
      expect(full.truncated).toBe(false);
    });

    it("does not replay a lower id that committed below the reconnect cursor (best-effort)", async () => {
      // Sequence-visibility gap: transaction A reserves id 7 but stays in flight
      // while transaction B commits id 8; the client persists Last-Event-ID 8,
      // then A commits 7.
      await feed(8);
      const clientCursor = 8n;
      await feed(7); // late lower commit, below the cursor
      await feed(9); // a normal post-cursor commit

      const { events } = await replayChangeFeedEvents(dbc, clientCursor);
      const ids = events.map((event) => Number(event.id));

      // Replay delivers post-cursor rows (9) — so an always-empty/broken replay
      // fails here — but a high-watermark query (`id > 8`) cannot see the late
      // lower commit (7). ADR 0021 does not ask it to: Last-Event-ID replay is a
      // best-effort latency optimization, not the delivery guarantee.
      // Correctness comes from the client refetching authoritative REST state on
      // reconnect, which reflects id 7's effect regardless of the push. Closing
      // this at the transport would need a txid low-watermark cursor (deferred
      // to the hardening slice).
      expect(ids).toEqual([9]);
      expect(ids).not.toContain(7);
    });
  });
});
