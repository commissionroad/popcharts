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
