import { and, eq, schema } from "src/db/client";
import type { MarketStatus } from "src/db/schema/markets";
// The generic "process db handle or the transaction a seam already opened"
// type; declared once for the change-feed writer and reused here rather than
// restated.
import type { LiveChangeWriter } from "src/change-feed/writer";
import { retryUntilIndexed } from "src/indexer/utils/retry-until-indexed";
import {
  formatOperatorAlert,
  OPERATOR_ALERT_EVENTS,
} from "src/shared/operator-alert-log";

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
 * Identity of the log a projection is applying. Carried only so the operator
 * page below can name it: the fault rolls its raw event row back, so no
 * committed row records which log wedged the cursor, and a market plus a status
 * pair tells an operator what broke without telling them what to replay.
 */
export type ProjectedLogIdentity = {
  blockNumber: bigint;
  logIndex: number;
  transactionHash: string;
};

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
   * when they look like they belong in the fault branch: the fault branch does
   * not stall one event, it abandons the sweep that hit it and wedges at least
   * that contract's whole cursor group until a human intervenes — see
   * applyMarketStatusTransition.
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
 * out-of-order arrival (MarketStatusOutOfOrderError). The row is locked for the
 * read so a concurrent writer cannot move the status between the check and the
 * write.
 *
 * The out-of-order throw is blunter than "this event's cursor stalls", and
 * anything that widens the fault branch has to price that in. It unwinds out of
 * the watcher's per-log loop and out of the loop over contract groups above it
 * (processLog -> sweepGroup -> sweep in
 * src/indexer/watchers/dynamic-address-watcher.ts), abandoning the rest of that
 * sweep: the faulting group never checkpoints its chunk, and groups the pass
 * had not reached are not swept at all. The discovery tick catches it, logs and
 * reschedules, so the next sweep re-fetches the same log and faults on it
 * again. Nothing self-clears.
 *
 * How far that spreads is set by the cursor grouping, so state it as a range
 * rather than guessing. Contracts are grouped by shared watermark: in steady
 * state they all sit on one, so a single market in an unexpected status takes
 * the entire pass with it. Once the fault leaves cursors uneven the groups
 * split, and groups the loop reaches before the faulting one go back to
 * completing — the faulting contract's group never does. The floor is therefore
 * one contract group wedged until a human intervenes, and the ceiling is every
 * contract the offending watcher follows; one delayed event is not on the
 * range. The ceiling stops at that watcher, though: each is its own closure,
 * interval and cursor name, so the other postgraduation watchers (venue
 * orders, pool ticks, token transfers) keep indexing throughout — which is
 * part of why the stall reads as "some data is late", not as an outage.
 *
 * Live delivery is the exception that proves it: onLogs catches per log, so a
 * fault there is skipped rather than fatal, and the page can precede any stall.
 * But live delivery never moves a watermark, so the sweep re-fetches that same
 * log and hits the same wall.
 *
 * Nothing crashes and nothing is lost: refusing to checkpoint is exactly what
 * keeps the events replayable once the cause is fixed. That is also why the
 * stall would otherwise be invisible, so the fault branch raises an operator
 * page before it throws.
 */
export async function applyMarketStatusTransition(
  tx: LiveChangeWriter,
  {
    chainId,
    marketId,
    sourceEvent,
    transition,
    updatedAt,
  }: {
    chainId: number;
    marketId: bigint;
    sourceEvent: ProjectedLogIdentity;
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
    // Raised before the throw, and so from inside a transaction that is about
    // to roll back — deliberately the opposite rule to the dispute page in
    // postgrad-dispute.ts, which fires only once its row commits. There a
    // rollback means nothing happened and paging would be a false alarm; here
    // the rollback *is* the incident, and no committed row will record it.
    //
    // Repeats on every retry, because the sweep re-fetches the same log each
    // discovery tick and faults on it again. That is wanted: it holds the
    // alarm in ALARM instead of lapsing back to OK after one quiet minute,
    // and SNS notifies on the state change, so the operator is paged once and
    // can see the halt is still live.
    console.error(
      formatOperatorAlert(OPERATOR_ALERT_EVENTS.marketStatusOutOfOrder, {
        // Which market, which status pair, and which log. A stalled cursor
        // reported without them leaves an operator grepping the log group for
        // the market to unwedge and the chain for the event to replay — and
        // the rollback means nothing else will record either.
        allowedFrom: transition.from.join(","),
        // uint256s render as decimal strings: JSON.stringify throws on bigint.
        blockNumber: sourceEvent.blockNumber.toString(),
        chainId,
        currentStatus: current.status,
        logIndex: sourceEvent.logIndex,
        marketId: marketId.toString(),
        targetStatus: transition.to,
        transactionHash: sourceEvent.transactionHash,
      }),
    );

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
