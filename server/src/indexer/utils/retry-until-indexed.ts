export type RetryUntilIndexedOptions = {
  attempts?: number;
  delayMs?: number;
  /** Which errors mean "the dependency row is not indexed yet; wait". */
  isRetryable: (error: unknown) => boolean;
  label: string;
  /** Names the missing dependency in retry logs, e.g. "MarketCreated". */
  waitingFor: string;
};

const DEFAULT_ATTEMPTS = 10;
const DEFAULT_DELAY_MS = 500;

/**
 * Retries an indexer persistence operation while it reports that a row it
 * depends on has not been indexed yet — the ordering hazard between
 * independent per-event watchers. If retries run out the error propagates,
 * the event's block cursor is never advanced, and recovery replays the event
 * later.
 */
export async function retryUntilIndexed<T>(
  operation: () => Promise<T>,
  {
    attempts = DEFAULT_ATTEMPTS,
    delayMs = DEFAULT_DELAY_MS,
    isRetryable,
    label,
    waitingFor,
  }: RetryUntilIndexedOptions,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error) || attempt >= attempts) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[${label}] ${message} Waiting ${delayMs}ms for ${waitingFor} (attempt ${attempt}/${attempts}).`,
      );
      await sleep(delayMs);
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
