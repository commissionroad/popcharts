import { mineBlock } from "./chain-time";

type WaitOptions = {
  intervalMs?: number;
  /**
   * Mine a block on every poll. Needed whenever the awaited condition depends
   * on the indexer observing the latest real transaction — the indexer runs
   * one block behind the tip, so on an idle chain the final transaction never
   * indexes until another block lands.
   */
  tickChain?: boolean;
  timeoutMs?: number;
};

/** Polls `probe` until it returns a truthy value or the timeout elapses. */
export async function waitForCondition<T>(
  label: string,
  probe: () => Promise<T | null | undefined | false>,
  {
    intervalMs = 1_000,
    tickChain = false,
    timeoutMs = 90_000,
  }: WaitOptions = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await probe();
    if (value) {
      return value;
    }

    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}.`);
    }

    if (tickChain) {
      await mineBlock();
    }

    await new Promise((resolvePoll) => setTimeout(resolvePoll, intervalMs));
  }
}
