import { asc, desc, gt, schema } from "src/db/client";
import type { db as productionDb } from "src/db/client";

import type { ChangeFeedHub } from "./hub";
import { changeFeedRowToEvent, type ChangeFeedEvent } from "./sources";

/**
 * Tails the change_feed outbox (repo ADR 0021) and publishes each new row to
 * the in-process hub. Poll-based by default — one indexed `WHERE id > cursor`
 * scan per tick — which needs no NOTIFY (whose commit-serialization lock we
 * avoid) and works through RDS Proxy. A coalesced NOTIFY doorbell can drive
 * `poll()` later with no change to correctness, because the durable table, not
 * the wake signal, is the source of truth.
 *
 * Ordering/dedup and the Postgres sequence-visibility gap (a lower id can commit
 * after a higher id has already been read) are handled by re-scanning a small
 * `lookback` window each tick and skipping ids already emitted: a late-committing
 * row inside the window is picked up on a subsequent poll, and a client that was
 * offline gets it regardless via the SSE route's Last-Event-ID replay.
 */

const DEFAULT_POLL_INTERVAL_MS = 250;
// Rows this many ids below the frontier are re-scanned each tick to catch a
// late-committing gap. Comfortably wider than any concurrent in-flight write
// burst at this app's write rate (a singleton indexer + low-rate runners).
const DEFAULT_LOOKBACK = 200n;
// A reconnecting client with a very stale cursor cold-refetches instead of
// replaying an unbounded backlog; retention keeps the feed small anyway.
const DEFAULT_REPLAY_LIMIT = 1000;

type RelayDb = typeof productionDb;

/** Construction inputs for {@link ChangeFeedRelay}: the `db` to tail and the
 * `hub` to publish to (both required), plus optional `pollIntervalMs` and
 * `lookback` (defaulting to 250ms / 200 ids) and an `onError` sink for poll
 * failures (defaults to swallowing). */
export interface ChangeFeedRelayOptions {
  db: RelayDb;
  hub: ChangeFeedHub;
  pollIntervalMs?: number;
  lookback?: bigint;
  onError?: (error: unknown) => void;
}

export class ChangeFeedRelay {
  private readonly db: RelayDb;
  private readonly hub: ChangeFeedHub;
  private readonly pollIntervalMs: number;
  private readonly lookback: bigint;
  private readonly onError?: (error: unknown) => void;

  /** Highest change_feed id seen so far; the poll floor trails it by `lookback`. */
  private highWaterMark = 0n;
  /** Ids already handled within the current lookback window — published live,
   * or seeded at start() to suppress replaying pre-existing rows — used to skip
   * re-delivery (dedup). */
  private readonly emitted = new Set<bigint>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(options: ChangeFeedRelayOptions) {
    this.db = options.db;
    this.hub = options.hub;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.lookback = options.lookback ?? DEFAULT_LOOKBACK;
    this.onError = options.onError;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /**
   * Snapshots the current frontier (so only genuinely new rows are delivered
   * live — historical catch-up is the SSE route's job) and begins polling.
   * Idempotent.
   */
  async start(): Promise<void> {
    if (this.timer) {
      return;
    }

    const recent = await this.db
      .select({ id: schema.changeFeed.id })
      .from(schema.changeFeed)
      .orderBy(desc(schema.changeFeed.id))
      .limit(Number(this.lookback));

    this.highWaterMark = recent[0]?.id ?? 0n;
    this.emitted.clear();
    for (const { id } of recent) {
      this.emitted.add(id);
    }

    this.timer = setInterval(() => {
      void this.pollSafely();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emitted.clear();
    this.highWaterMark = 0n;
  }

  private async pollSafely(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      await this.poll();
    } catch (error) {
      this.onError?.(error);
    } finally {
      this.polling = false;
    }
  }

  /** One tail pass: publish every not-yet-emitted row above the lookback floor. */
  async poll(): Promise<void> {
    const floor = this.floorId();
    const rows = await this.db
      .select()
      .from(schema.changeFeed)
      .where(gt(schema.changeFeed.id, floor))
      .orderBy(asc(schema.changeFeed.id));

    for (const row of rows) {
      if (this.emitted.has(row.id)) {
        continue;
      }
      const event = changeFeedRowToEvent(row);
      if (event) {
        this.hub.publish(event);
      }
      this.emitted.add(row.id);
      if (row.id > this.highWaterMark) {
        this.highWaterMark = row.id;
      }
    }

    this.pruneEmitted();
  }

  private floorId(): bigint {
    return this.highWaterMark > this.lookback
      ? this.highWaterMark - this.lookback
      : 0n;
  }

  private pruneEmitted(): void {
    const floor = this.floorId();
    for (const id of this.emitted) {
      if (id <= floor) {
        this.emitted.delete(id);
      }
    }
  }
}

/** The result of a Last-Event-ID replay: the routed `events` after the cursor,
 * and `truncated` when more rows exist beyond the capped page. */
export interface ChangeFeedReplay {
  events: ChangeFeedEvent[];
  /** True when the cap was hit, i.e. rows exist beyond this page — the cursor
   * is too old to resume from and the client should cold-refetch instead. */
  truncated: boolean;
}

/** The current maximum change_feed id (0 when empty) — the tail a cursorless
 * SSE client resumes from so it receives only subsequent updates. */
export async function changeFeedTipId(db: RelayDb): Promise<bigint> {
  const rows = await db
    .select({ id: schema.changeFeed.id })
    .from(schema.changeFeed)
    .orderBy(desc(schema.changeFeed.id))
    .limit(1);
  return rows[0]?.id ?? 0n;
}

/**
 * Reads the change_feed rows strictly after `sinceId` and maps them to events,
 * for the SSE route's Last-Event-ID replay. Capped so an ancient cursor cannot
 * pull an unbounded backlog; a full page signals truncation so the route can
 * tell the client to cold-refetch. Unrouted rows are dropped, so `events` can
 * be shorter than the scanned page.
 */
export async function replayChangeFeedEvents(
  db: RelayDb,
  sinceId: bigint,
  limit = DEFAULT_REPLAY_LIMIT,
): Promise<ChangeFeedReplay> {
  const rows = await db
    .select()
    .from(schema.changeFeed)
    .where(gt(schema.changeFeed.id, sinceId))
    .orderBy(asc(schema.changeFeed.id))
    .limit(limit);

  const events: ChangeFeedEvent[] = [];
  for (const row of rows) {
    const event = changeFeedRowToEvent(row);
    if (event) {
      events.push(event);
    }
  }
  return { events, truncated: rows.length === limit };
}
