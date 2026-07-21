import { mineBlock } from "./chain-time";

/**
 * Minimum spacing between tick-mined blocks. A chain-time jump makes the
 * devchain clock run permanently ahead of wall clock (hardhat keeps the
 * offset; time is forward-only — verified empirically in this suite), and
 * while the chain leads, every mined block can only push it further (each
 * block is at least parent+1). Throttling the ticks bounds that mining-added
 * drift to ~1s per spacing interval instead of ~1s per poll; the jump's own
 * offset is unavoidable and is budgeted in the scenarios' wall-clock waits.
 */
const TICK_MINE_SPACING_MS = 10_000;

type WaitOptions = {
  intervalMs?: number;
  /**
   * Mine while polling. Needed whenever the awaited condition depends on the
   * indexer observing the latest real transaction — the indexer runs one
   * block behind the tip, so on an idle chain the final transaction never
   * indexes until another block lands. The first poll mines immediately (to
   * flush that pending transaction); later mines are throttled to
   * TICK_MINE_SPACING_MS so ticking never sustains chain-vs-wall drift.
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
  let lastMineAt = 0;

  for (;;) {
    const value = await probe();
    if (value) {
      return value;
    }

    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}.`);
    }

    if (tickChain && Date.now() - lastMineAt >= TICK_MINE_SPACING_MS) {
      await mineBlock();
      lastMineAt = Date.now();
    }

    await new Promise((resolvePoll) => setTimeout(resolvePoll, intervalMs));
  }
}
