import { db } from "src/db/client";

import { ChangeFeedHub } from "./hub";
import {
  ChangeFeedRelay,
  changeFeedTipId,
  replayChangeFeedEvents,
  type ChangeFeedReplay,
} from "./relay";

/**
 * The per-process singleton that binds the change-feed hub to its relay (repo
 * ADR 0021): the relay polls the outbox only while at least one SSE client is
 * subscribed, so an idle API instance issues no change_feed queries. Each
 * autoscaled instance runs its own hub+relay over the shared table — no Redis,
 * because Postgres is the fan-out source of truth.
 */

let hub: ChangeFeedHub | null = null;
let relay: ChangeFeedRelay | null = null;
let reconciling = false;
let reconcileQueued = false;

function ensureService(): { hub: ChangeFeedHub; relay: ChangeFeedRelay } {
  if (!hub || !relay) {
    hub = new ChangeFeedHub({
      onSubscriberCountChange: () => {
        void reconcile();
      },
    });
    relay = new ChangeFeedRelay({
      db,
      hub,
      onError: (error) => {
        console.error("[change-feed] relay poll failed", error);
      },
    });
  }
  return { hub, relay };
}

/**
 * Serialized reconcile of relay run-state to current demand. Serializing avoids
 * two overlapping `start()`s racing to create intervals, and the queued re-run
 * catches a subscriber-count change that lands mid-`await`.
 */
async function reconcile(): Promise<void> {
  if (reconciling) {
    reconcileQueued = true;
    return;
  }
  reconciling = true;
  try {
    do {
      reconcileQueued = false;
      const { hub: currentHub, relay: currentRelay } = ensureService();
      if (currentHub.subscriberCount > 0) {
        try {
          await currentRelay.start();
        } catch (error) {
          // start()'s frontier SELECT can reject; swallow to the poll-error
          // sink rather than let `void reconcile()` become an unhandled
          // rejection. The next subscriber-count change retries start().
          console.error("[change-feed] relay start failed", error);
        }
      } else {
        currentRelay.stop();
      }
    } while (reconcileQueued);
  } finally {
    reconciling = false;
  }
}

/** The process hub; subscribing to it starts the relay, unsubscribing stops it. */
export function changeFeedHub(): ChangeFeedHub {
  return ensureService().hub;
}

/** Replays outbox events after a client's Last-Event-ID against the live db. */
export function replayChangeFeed(sinceId: bigint): Promise<ChangeFeedReplay> {
  return replayChangeFeedEvents(db, sinceId);
}

/** The current tail id, used to start a cursorless (fresh) SSE client from
 * "now" instead of replaying the whole retained window. */
export function changeFeedTip(): Promise<bigint> {
  return changeFeedTipId(db);
}
