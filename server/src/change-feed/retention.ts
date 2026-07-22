import { asc, db as productionDb, inArray, lt, schema } from "src/db/client";

type RetentionDb = typeof productionDb;

/** ~48h: long enough that a briefly-offline client still resumes via
 * Last-Event-ID, short enough to keep the outbox small. */
export const DEFAULT_RETENTION_MS = 48 * 60 * 60 * 1000;
/** Hourly is ample for an age-based sweep of an append-only log. */
export const DEFAULT_RETENTION_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 5_000;

/**
 * Deletes `change_feed` rows older than `olderThan`, in bounded batches so a
 * large backlog cannot lock the table in one statement. Returns the number of
 * rows removed. Safe to run while the relay tails the feed: it only ever deletes
 * below the retention horizon, far behind any live cursor.
 */
export async function pruneChangeFeed(
  db: RetentionDb,
  {
    olderThan,
    batchSize = DEFAULT_BATCH_SIZE,
  }: { olderThan: Date; batchSize?: number },
): Promise<number> {
  let deleted = 0;

  for (;;) {
    const rows = await db
      .select({ id: schema.changeFeed.id })
      .from(schema.changeFeed)
      .where(lt(schema.changeFeed.createdAt, olderThan))
      .orderBy(asc(schema.changeFeed.id))
      .limit(batchSize);

    if (rows.length === 0) {
      break;
    }

    await db.delete(schema.changeFeed).where(
      inArray(
        schema.changeFeed.id,
        rows.map((row) => row.id),
      ),
    );
    deleted += rows.length;

    if (rows.length < batchSize) {
      break;
    }
  }

  return deleted;
}

export interface ChangeFeedRetentionOptions {
  db?: RetentionDb;
  retentionMs?: number;
  intervalMs?: number;
  batchSize?: number;
  onError?: (error: unknown) => void;
  onPruned?: (deleted: number) => void;
}

/**
 * Starts the always-on retention sweep for the change-feed outbox (repo ADR
 * 0021): unlike the relay it does NOT gate on connected clients, because the
 * indexer keeps appending whether or not anyone is subscribed, so the log grows
 * regardless. Runs one sweep immediately, then every `intervalMs`. Returns a
 * stop function that clears the timer. Observability is the caller's `onPruned`
 * / `onError`; the API logs both.
 */
export function startChangeFeedRetention(
  options: ChangeFeedRetentionOptions = {},
): () => void {
  const db = options.db ?? productionDb;
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_RETENTION_INTERVAL_MS;
  const batchSize = options.batchSize;

  const sweep = async () => {
    try {
      const deleted = await pruneChangeFeed(db, {
        olderThan: new Date(Date.now() - retentionMs),
        ...(batchSize === undefined ? {} : { batchSize }),
      });
      options.onPruned?.(deleted);
    } catch (error) {
      options.onError?.(error);
    }
  };

  void sweep();
  const timer = setInterval(() => void sweep(), intervalMs);

  return () => clearInterval(timer);
}
