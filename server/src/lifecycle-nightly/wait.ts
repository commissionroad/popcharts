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
   * TICK_MINE_SPACING_MS, with one final flush-and-reprobe at the deadline
   * so a service transaction landing after the last tick still gets its
   * follower block before the wait is declared failed.
   */
  tickChain?: boolean;
  timeoutMs?: number;
};

/**
 * Polls `probe` until it returns a truthy value or the timeout elapses. A
 * throwing probe counts as "not ready yet" rather than aborting the wait —
 * the multi-minute service waits must survive a transient API 5xx or
 * database blip — but the last probe error is carried into the timeout
 * message so a persistently failing probe still diagnoses itself.
 */
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
  let lastProbeError: unknown;

  for (;;) {
    let value: T | null | undefined | false;
    try {
      value = await probe();
      lastProbeError = undefined;
    } catch (error) {
      value = null;
      lastProbeError = error;
    }
    if (value) {
      return value;
    }

    if (Date.now() >= deadline) {
      if (tickChain) {
        await mineBlock();
        await new Promise((resolveSleep) =>
          setTimeout(resolveSleep, intervalMs),
        );
        const flushed = await probe().catch(() => null);
        if (flushed) {
          return flushed;
        }
      }
      const probeNote =
        lastProbeError === undefined
          ? ""
          : ` Last probe error: ${
              lastProbeError instanceof Error
                ? lastProbeError.message
                : String(lastProbeError)
            }`;
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for ${label}.${probeNote}`,
      );
    }

    if (tickChain && Date.now() - lastMineAt >= TICK_MINE_SPACING_MS) {
      await mineBlock();
      lastMineAt = Date.now();
    }

    await new Promise((resolvePoll) => setTimeout(resolvePoll, intervalMs));
  }
}
