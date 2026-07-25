import { and, eq, schema } from "src/db/client";
import type { MarketStatus } from "src/db/schema/markets";
// The generic "process db handle or the transaction a seam already opened"
// type; declared once for the change-feed writer and reused here rather than
// restated.
import type { LiveChangeWriter } from "src/change-feed/writer";
import { retryUntilIndexed } from "src/indexer/utils/retry-until-indexed";

/**
 * Every projection update on the markets row assumes the MarketCreated event
 * has already been persisted, but each watcher runs independently, so a later
 * lifecycle event (review approval, graduation, receipt placement, ...) can be
 * processed first. Handlers throw MarketNotIndexedError to signal that
 * ordering hazard instead of silently matching zero rows, and watchers wrap
 * persistence in retryUntilMarketIndexed to wait for the market-created
 * watcher to catch up. If retries run out the error propagates, the event's
 * block cursor is never advanced, and recovery replays the event later.
 */
export class MarketNotIndexedError extends Error {
  constructor({ chainId, marketId }: { chainId: number; marketId: bigint }) {
    super(
      `Market chainId=${chainId} marketId=${marketId} has no markets row yet; MarketCreated has not been persisted.`,
    );
    this.name = "MarketNotIndexedError";
  }
}

/**
 * A guarded status move: which statuses the market may hold for the move to
 * apply, which status to write, and which statuses already reflect this move or
 * a later one. The third set is what separates a harmless replay from an
 * ordering fault — without it, "zero rows updated" conflates the two.
 */
export type MarketStatusTransition = {
  from: readonly MarketStatus[];
  to: MarketStatus;
  /**
   * Statuses at or past `to`; reaching one means the move already happened, so
   * the event is a no-op rather than a fault. Keep terminal statuses here even
   * when they look like they belong in the fault branch: watchers share one
   * cursor per subscription, so a handler that throws on an unreachable state
   * wedges every other event family behind it indefinitely.
   */
  atOrPast: readonly MarketStatus[];
};

/**
 * Thrown when a status-projecting event arrives while the market sits in a
 * status that is neither a valid predecessor nor already at or past the
 * target — an ordering fault between watchers. It must not be swallowed: the
 * raw event row commits on first sight, so a silently skipped projection is
 * skipped forever once `onConflictDoNothing` starts deduping the replay.
 */
export class MarketStatusOutOfOrderError extends Error {
  constructor({
    chainId,
    current,
    marketId,
    transition,
  }: {
    chainId: number;
    current: MarketStatus;
    marketId: bigint;
    transition: MarketStatusTransition;
  }) {
    super(
      `Market chainId=${chainId} marketId=${marketId} is '${current}'; cannot project '${transition.to}' (expected one of ${transition.from.join(", ")}).`,
    );
    this.name = "MarketStatusOutOfOrderError";
  }
}

/**
 * Applies a guarded status move inside the caller's transaction, distinguishing
 * the three outcomes a bare guarded UPDATE cannot: no markets row yet
 * (MarketNotIndexedError), already at or past the target (a no-op), and an
 * out-of-order arrival (MarketStatusOutOfOrderError, which propagates so the
 * watcher's cursor never advances past an unprojected event). The row is locked
 * for the read so a concurrent writer cannot move the status between the check
 * and the write.
 */
export async function applyMarketStatusTransition(
  tx: LiveChangeWriter,
  {
    chainId,
    marketId,
    transition,
    updatedAt,
  }: {
    chainId: number;
    marketId: bigint;
    transition: MarketStatusTransition;
    updatedAt: Date;
  },
): Promise<void> {
  const where = and(
    eq(schema.markets.chainId, chainId),
    eq(schema.markets.marketId, marketId),
  );

  const [current] = await tx
    .select({ status: schema.markets.status })
    .from(schema.markets)
    .where(where)
    .for("update");

  if (!current) {
    throw new MarketNotIndexedError({ chainId, marketId });
  }

  if (transition.atOrPast.includes(current.status)) {
    return;
  }

  if (!transition.from.includes(current.status)) {
    throw new MarketStatusOutOfOrderError({
      chainId,
      current: current.status,
      marketId,
      transition,
    });
  }

  await tx
    .update(schema.markets)
    .set({ status: transition.to, updatedAt })
    .where(where);
}

export type RetryUntilMarketIndexedOptions = {
  attempts?: number;
  delayMs?: number;
  label: string;
};

/**
 * Retries a persistence operation until its markets row exists, treating only
 * MarketNotIndexedError as "wait for the MarketCreated watcher".
 */
export async function retryUntilMarketIndexed<T>(
  operation: () => Promise<T>,
  { attempts, delayMs, label }: RetryUntilMarketIndexedOptions,
): Promise<T> {
  return retryUntilIndexed(operation, {
    attempts,
    delayMs,
    isRetryable: (error) => error instanceof MarketNotIndexedError,
    label,
    waitingFor: "MarketCreated",
  });
}
