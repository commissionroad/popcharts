// Drives the SSE stream generator directly (repo ADR 0021) to prove the
// subscribe→replay→live handshake: control frames, replay-vs-live dedup by the
// set of replayed ids, late-arriving gap-id delivery, the best-effort drop of a
// commit below the reconnect cursor, heartbeat, reset on truncation, abort, and
// teardown. Pure — a hub plus an injected replay, no database.
import { describe, expect, it } from "bun:test";

import { ChangeFeedHub } from "src/change-feed/hub";
import type { ChangeFeedReplay } from "src/change-feed/relay";
import { changeFeedEventStream } from "src/change-feed/stream";
import type { ChangeFeedEvent } from "src/change-feed/sources";

const CHANNEL = "market:31337:42";

function evt(id: number, channels: string[] = [CHANNEL]): ChangeFeedEvent {
  return {
    id: BigInt(id),
    channels,
    sourceTable: "receipt_placed_events",
    op: "insert",
    chainId: 31337,
    marketId: "42",
    owner: null,
    blockNumber: null,
    logIndex: null,
  };
}

function replayOf(
  events: ChangeFeedEvent[],
  truncated = false,
): (sinceId: bigint) => Promise<ChangeFeedReplay> {
  return async () => ({ events, truncated });
}

const NO_REPLAY = replayOf([]);
const LONG_HEARTBEAT = 60_000;

describe("changeFeedEventStream", () => {
  it("opens with ready, then replays matching events in order", async () => {
    const hub = new ChangeFeedHub();
    const stream = changeFeedEventStream({
      hub,
      channels: [CHANNEL],
      sinceId: 0n,
      replay: replayOf([evt(1), evt(2, ["market:31337:99"]), evt(3)]),
      heartbeatMs: LONG_HEARTBEAT,
    });

    expect(await stream.next()).toMatchObject({
      value: { event: "ready", data: { channels: [CHANNEL] } },
    });
    // evt(2) routes to a channel this client did not subscribe to → skipped.
    expect((await stream.next()).value).toMatchObject({
      event: "change",
      id: "1",
    });
    expect((await stream.next()).value).toMatchObject({
      event: "change",
      id: "3",
    });

    await stream.return(undefined);
    expect(hub.subscriberCount).toBe(0);
  });

  it("delivers a live event published after replay", async () => {
    const hub = new ChangeFeedHub();
    const stream = changeFeedEventStream({
      hub,
      channels: [CHANNEL],
      sinceId: 0n,
      replay: replayOf([evt(2)]),
      heartbeatMs: LONG_HEARTBEAT,
    });
    await stream.next(); // ready
    await stream.next(); // replay id 2

    const pending = stream.next();
    hub.publish(evt(5));
    expect((await pending).value).toMatchObject({ event: "change", id: "5" });

    await stream.return(undefined);
  });

  it("drops a live event already covered by the replay (dedup by replayed-id set)", async () => {
    const hub = new ChangeFeedHub();
    const stream = changeFeedEventStream({
      hub,
      channels: [CHANNEL],
      sinceId: 0n,
      replay: replayOf([evt(2)]),
      heartbeatMs: LONG_HEARTBEAT,
    });
    await stream.next(); // ready
    await stream.next(); // replay id 2

    const pending = stream.next();
    hub.publish(evt(2)); // already in the replayed-id set → skipped
    hub.publish(evt(3)); // new → delivered
    expect((await pending).value).toMatchObject({ event: "change", id: "3" });

    await stream.return(undefined);
  });

  it("delivers a late lower id (sequence gap) that was never in the replay set", async () => {
    const hub = new ChangeFeedHub();
    const stream = changeFeedEventStream({
      hub,
      channels: [CHANNEL],
      sinceId: 0n,
      replay: replayOf([evt(2)]),
      heartbeatMs: LONG_HEARTBEAT,
    });
    await stream.next(); // ready
    await stream.next(); // replay id 2

    const first = stream.next();
    hub.publish(evt(5));
    expect((await first).value).toMatchObject({ id: "5" });

    const second = stream.next();
    hub.publish(evt(3)); // 3 was never replayed, so it still ships even after 5
    expect((await second).value).toMatchObject({ id: "3" });

    await stream.return(undefined);
  });

  it("delivers a late gap id that is below an already-replayed higher id", async () => {
    // The sequence-visibility gap: 7 was in-flight while 8,9,10 committed and
    // replayed. Set-based dedup must still ship 7 when the relay recovers it,
    // where a "max replayed id" threshold (10) would silently drop it.
    const hub = new ChangeFeedHub();
    const stream = changeFeedEventStream({
      hub,
      channels: [CHANNEL],
      sinceId: 0n,
      replay: replayOf([evt(8), evt(9), evt(10)]),
      heartbeatMs: LONG_HEARTBEAT,
    });
    await stream.next(); // ready
    await stream.next(); // replay 8
    await stream.next(); // replay 9
    await stream.next(); // replay 10

    const pending = stream.next();
    hub.publish(evt(10)); // overlap with replay → dropped
    hub.publish(evt(7)); // never replayed, above sinceId → delivered
    expect((await pending).value).toMatchObject({ event: "change", id: "7" });

    await stream.return(undefined);
  });

  it("drops a live commit at or below the reconnect cursor (best-effort push)", async () => {
    const hub = new ChangeFeedHub();
    const stream = changeFeedEventStream({
      hub,
      channels: [CHANNEL],
      // The previous connection received id 8 before the transaction holding
      // id 7 committed, then persisted 8 as its reconnect cursor.
      sinceId: 8n,
      replay: NO_REPLAY,
      heartbeatMs: LONG_HEARTBEAT,
    });
    await stream.next(); // ready

    const pending = stream.next();
    // The relay's lookback may rediscover 7 live, but a high-watermark cursor
    // cannot place it (7 <= 8), so it is dropped. That is acceptable: on
    // reconnect the client refetches authoritative REST, which reflects id 7 —
    // the push is best-effort, never the guarantee (ADR 0021). Delivering 9
    // proves 7 was skipped, not merely delayed.
    hub.publish(evt(7));
    hub.publish(evt(9));
    expect((await pending).value).toMatchObject({ event: "change", id: "9" });

    await stream.return(undefined);
  });

  it("emits a reset frame when the replay was truncated", async () => {
    const hub = new ChangeFeedHub();
    const stream = changeFeedEventStream({
      hub,
      channels: [CHANNEL],
      sinceId: 0n,
      replay: replayOf([evt(1)], true),
      heartbeatMs: LONG_HEARTBEAT,
    });
    await stream.next(); // ready
    await stream.next(); // replay id 1
    expect((await stream.next()).value).toMatchObject({
      event: "reset",
      data: { reason: "cursor-too-old" },
    });

    await stream.return(undefined);
  });

  it("emits a heartbeat ping when idle", async () => {
    const hub = new ChangeFeedHub();
    const stream = changeFeedEventStream({
      hub,
      channels: [CHANNEL],
      sinceId: 0n,
      replay: NO_REPLAY,
      heartbeatMs: 5,
    });
    await stream.next(); // ready
    expect((await stream.next()).value).toMatchObject({ event: "ping" });

    await stream.return(undefined);
  });

  it("ends and unsubscribes when the request aborts", async () => {
    const hub = new ChangeFeedHub();
    const controller = new AbortController();
    const stream = changeFeedEventStream({
      hub,
      channels: [CHANNEL],
      sinceId: 0n,
      replay: NO_REPLAY,
      heartbeatMs: LONG_HEARTBEAT,
      signal: controller.signal,
    });
    await stream.next(); // ready

    const pending = stream.next();
    controller.abort();
    expect(await pending).toEqual({ done: true, value: undefined });
    expect(hub.subscriberCount).toBe(0);
  });
});
