type WaitOptions = {
  intervalMs?: number;
  timeoutMs?: number;
};

/**
 * Polls `probe` until it returns a truthy value or the timeout elapses. A
 * throwing probe counts as "not ready yet" rather than aborting the wait —
 * the multi-minute service waits must survive a transient API 5xx or
 * database blip — but the last probe error is carried into the timeout
 * message so a persistently failing probe still diagnoses itself.
 *
 * Nothing here nudges the chain. The waits used to mine a block per tick so an
 * idle devchain would flush the last real transaction to the indexer, on the
 * theory that the indexer trails the tip by one block. That is no longer worth
 * carrying: the indexer's local recovery sweep re-reads every block up to the
 * current head every two seconds (`indexer/index.ts`), so the final
 * transaction indexes without another block landing — and the chain the suite
 * is moving to mines every 200ms on its own and has no `evm_mine` to call
 * (ADR 0028 G1, G3).
 */
export async function waitForCondition<T>(
  label: string,
  probe: () => Promise<T | null | undefined | false>,
  { intervalMs = 1_000, timeoutMs = 90_000 }: WaitOptions = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
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

    await new Promise((resolvePoll) => setTimeout(resolvePoll, intervalMs));
  }
}
