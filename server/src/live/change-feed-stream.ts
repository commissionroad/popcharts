import type { ChangeFeedHub } from "./change-feed-hub";
import type { ChangeFeedReplay } from "./change-feed-relay";
import { channelsIntersect, type ChangeFeedEvent } from "./change-feed-sources";

/**
 * The transport-agnostic core of the live-updates SSE endpoint (repo ADR 0021),
 * extracted from the Elysia route so the tricky parts — the subscribe-then-
 * replay handshake, replay-vs-live dedup, heartbeat, and teardown — are unit
 * testable without HTTP streaming. The route is a thin wrapper that maps each
 * yielded message through Elysia's `sse()`.
 *
 * Correctness of "no gap, no dupe" rests on the ordering:
 *   1. subscribe to the hub first (buffering live events),
 *   2. THEN replay change_feed rows after the client's Last-Event-ID,
 *   3. then emit buffered/live events that were not already replayed.
 * A row committed between (1) and (2) appears in both the replay and the live
 * buffer; dedup is by the SET of ids actually replayed, so the live copy is
 * dropped but a late-committing lower id that replay never saw (the
 * sequence-visibility gap the relay recovers) is still delivered — a scalar
 * "max replayed id" threshold would wrongly drop it. Residual: an id that
 * commits below the client's `sinceId` after that cursor advanced past it is
 * not recoverable through a high-watermark cursor; closing that fully needs a
 * txid low-watermark cursor and is left to the hardening slice.
 */

/** One SSE frame the stream yields — a `change` signal carrying the cursor id,
 * or a `ready`/`ping`/`reset` control frame with no id. */
export interface ChangeFeedStreamMessage {
  /** SSE `id:` — the change_feed cursor a client echoes back as Last-Event-ID.
   * Absent on control frames (ready/ping/reset), which must not move the cursor. */
  id?: string;
  event: string;
  data: unknown;
}

/** The injected inputs to {@link changeFeedEventStream}: the `hub` to subscribe
 * on, the `channels` filter, the `sinceId` resume cursor (the client's
 * Last-Event-ID), the `replay` reader for catch-up, and the optional heartbeat
 * cadence and request abort `signal`. */
export interface ChangeFeedStreamOptions {
  hub: ChangeFeedHub;
  channels: string[];
  sinceId: bigint;
  replay: (sinceId: bigint) => Promise<ChangeFeedReplay>;
  heartbeatMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_HEARTBEAT_MS = 15_000;

function serializeEvent(event: ChangeFeedEvent) {
  return {
    id: event.id.toString(),
    channels: event.channels,
    source: event.sourceTable,
    op: event.op,
    chainId: event.chainId,
    marketId: event.marketId,
    owner: event.owner,
    blockNumber:
      event.blockNumber === null ? null : event.blockNumber.toString(),
    logIndex: event.logIndex,
  };
}

function changeMessage(event: ChangeFeedEvent): ChangeFeedStreamMessage {
  return {
    id: event.id.toString(),
    event: "change",
    data: serializeEvent(event),
  };
}

export async function* changeFeedEventStream(
  options: ChangeFeedStreamOptions,
): AsyncGenerator<ChangeFeedStreamMessage> {
  const { hub, channels, sinceId, replay, signal } = options;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;

  // A client that subscribes to nothing gets an open-but-silent stream rather
  // than an error; nothing to route to it.
  const channelSet = new Set(channels);

  const queue: ChangeFeedEvent[] = [];
  let wake: (() => void) | null = null;
  const unsubscribe = hub.subscribe(channels, (event) => {
    queue.push(event);
    wake?.();
  });
  const onAbort = () => wake?.();
  signal?.addEventListener("abort", onAbort);

  try {
    yield { event: "ready", data: { channels } };

    const { events, truncated } = await replay(sinceId);
    // The exact ids delivered during replay, so a live event that overlaps the
    // replay window is dropped by identity — not by an id threshold, which
    // would also drop a late-committing lower gap id replay never returned.
    // Bounded by the replay page (<= the relay's replay cap).
    const replayedIds = new Set<bigint>();
    for (const event of events) {
      if (!channelsIntersect(channelSet, event.channels)) {
        continue;
      }
      yield changeMessage(event);
      replayedIds.add(event.id);
    }
    if (truncated) {
      // The cursor predates the retention window; the client has a gap only a
      // full refetch can close.
      yield { event: "reset", data: { reason: "cursor-too-old" } };
    }

    while (!signal?.aborted) {
      while (queue.length > 0) {
        const event = queue.shift()!;
        // Drop only what the client already has: anything at or before its
        // resume cursor, or a row already emitted during this replay. A newer
        // id — including a late-arriving lower one above sinceId — is delivered.
        if (event.id <= sinceId || replayedIds.has(event.id)) {
          continue;
        }
        yield changeMessage(event);
      }
      if (signal?.aborted) {
        break;
      }
      if ((await waitForWakeOrHeartbeat()) === "heartbeat") {
        yield { event: "ping", data: "" };
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    unsubscribe();
  }

  function waitForWakeOrHeartbeat(): Promise<"wake" | "heartbeat"> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        wake = null;
        resolve("heartbeat");
      }, heartbeatMs);
      wake = () => {
        clearTimeout(timer);
        wake = null;
        resolve("wake");
      };
    });
  }
}
