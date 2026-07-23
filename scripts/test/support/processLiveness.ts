import { sleep } from "../../shared/wait/sleep.ts";

/**
 * Liveness probes shared by the process-teardown tests. Both supervisor and
 * group-signal teardown are asserted the same way — signal a pid with 0 and
 * poll until the OS has actually reaped it — so the pair lives here rather
 * than being copied into each spec.
 */

/** True unless signalling the pid fails with ESRCH (no such process). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    // EPERM means the process exists but we may not signal it — still alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Polls `predicate` every 50ms until it holds, throwing once `timeoutMs`
 * elapses. Throwing rather than returning quietly keeps a never-satisfied
 * condition from being read as a pass by the assertion that follows it.
 */
export async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`condition not met within ${timeoutMs}ms`);
    }
    await sleep(50);
  }
}
