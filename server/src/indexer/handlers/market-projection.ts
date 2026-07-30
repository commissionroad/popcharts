import { and, eq, schema } from "src/db/client";
import type { MarketStatus } from "src/db/schema/markets";
// The generic "process db handle or the transaction a seam already opened"
// type; declared once for the change-feed writer and reused here rather than
// restated.
import type { LiveChangeWriter } from "src/change-feed/writer";
import { ParkSweepError } from "src/indexer/utils/park-sweep-error";
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
 * watcher to catch up. If retries run out the error parks the sweep at this
 * log, the event's block cursor is never advanced, and recovery replays the
 * event later.
 */
export class MarketNotIndexedError extends ParkSweepError {
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
   * not stall one event, it parks this market's cursor until a human
   * intervenes and pages an operator on the way — see
   * applyMarketStatusTransition.
   */
  atOrPast: readonly MarketStatus[];
};

/**
 * Thrown when a status-projecting event arrives while the market sits in a
 * status that is neither a valid predecessor nor already at or past the
 * target — an ordering fault between watchers.
 *
 * It must not be caught and shrugged off inside the handler. Returning
 * normally here would commit the raw event row without its projection, and
 * every later replay dedupes out on `onConflictDoNothing` before reaching the
 * projection again — so the transition would be lost permanently. Throwing is
 * what rolls the row back and keeps the event replayable; parking (below) is
 * what keeps that from costing more than the one market.
 */
export class MarketStatusOutOfOrderError extends ParkSweepError {
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
 * Both throws are ParkSweepErrors, so the watcher parks this one market's
 * cursor below the offending log and sweeps every other contract past it
 * (processLog in src/indexer/watchers/dynamic-address-watcher.ts). The cursor
 * never moves past an unapplied event, so the next sweep re-fetches the same
 * log — and, for the out-of-order case, faults on it again. Nothing
 * self-clears; that is deliberate, because refusing to checkpoint is exactly
 * what keeps the event replayable once the cause is fixed.
 *
 * What it costs while it sits there is one market's lifecycle events, which
 * stop arriving. Every other market keeps indexing, and sibling watchers
 * (venue orders, pool ticks, token transfers) hold their own cursors and never
 * notice. Nothing crashes and nothing is lost, which is precisely why it would
 * otherwise be invisible — hence the operator page below.
 *
 * This used to be far worse, and the history is the reason to keep the
 * ParkSweepError base rather than "simplifying" back to a bare throw: the
 * error escaped the per-log loop *and* the loop over contract groups, so one
 * market in an unexpected status abandoned the whole pass and starved every
 * group the loop had not yet reached — permanently, since the fault reproduces
 * on every tick.
 *
 * Live delivery is a separate path: onLogs catches per log, so a fault there
 * is skipped rather than parking anything, and the page can precede any stall.
 * But live delivery never moves a watermark, so the sweep re-fetches that same
 * log and reaches the same conclusion.
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
    // can see the stall is still live.
    console.error(
      formatOperatorAlert(OPERATOR_ALERT_EVENTS.marketStatusOutOfOrder, {
        // Which market, which status pair, and which log. The stall is now
        // confined to one market, which makes it quieter, not easier to find:
        // reported without these an operator has to grep the log group for the
        // market to unwedge and the chain for the event to replay — and the
        // rollback means nothing else will record either.
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

/**
 * How long to wait for the MarketCreated watcher, and what to call the wait in
 * the log. `attempts` and `delayMs` fall back to retryUntilIndexed's defaults;
 * `label` is required because an unlabelled wait is indistinguishable from
 * every other watcher's wait in a shared log group.
 */
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
