/**
 * Single-flight task scheduler for the venue keeper: at most one run per key
 * is in flight, and triggers that arrive mid-run coalesce into exactly one
 * trailing run of the most recently scheduled task. Swap bursts therefore
 * cost one re-check instead of a queue, and the keeper's own arbitrage swaps
 * re-trigger at most one trailing pass (which reads prices back inside
 * tolerance and holds).
 */
export function createSingleFlightScheduler({
  onError,
}: {
  onError: (key: string, error: unknown) => void;
}) {
  const states = new Map<string, { queued: boolean; task: Task }>();

  async function run(key: string, task: Task): Promise<void> {
    const existing = states.get(key);

    if (existing) {
      existing.queued = true;
      existing.task = task;
      return;
    }

    states.set(key, { queued: false, task });

    try {
      for (;;) {
        const state = states.get(key)!;
        const current = state.task;
        state.queued = false;

        try {
          await current();
        } catch (error) {
          onError(key, error);
        }

        if (!states.get(key)!.queued) {
          break;
        }
      }
    } finally {
      states.delete(key);
    }
  }

  return {
    /** Number of keys currently running (visible for tests and logging). */
    inFlight: () => states.size,
    schedule: run,
  };
}

type Task = () => Promise<void>;

export type SingleFlightScheduler = ReturnType<
  typeof createSingleFlightScheduler
>;
