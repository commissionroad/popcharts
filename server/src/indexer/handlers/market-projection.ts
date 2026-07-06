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

const DEFAULT_ATTEMPTS = 10;
const DEFAULT_DELAY_MS = 500;

export async function retryUntilMarketIndexed<T>(
  operation: () => Promise<T>,
  {
    attempts = DEFAULT_ATTEMPTS,
    delayMs = DEFAULT_DELAY_MS,
    label,
  }: RetryUntilMarketIndexedOptions,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof MarketNotIndexedError) || attempt >= attempts) {
        throw error;
      }

      console.warn(
        `[${label}] ${error.message} Waiting ${delayMs}ms for MarketCreated (attempt ${attempt}/${attempts}).`,
      );
      await sleep(delayMs);
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
