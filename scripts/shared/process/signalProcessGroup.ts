/**
 * Signals the whole process GROUP led by `pid` instead of that pid alone.
 *
 * Orchestration scripts start services through wrappers (`pnpm run x`,
 * `bun run y`) that spawn the real process as a grandchild. Signalling only the
 * wrapper leaves the grandchild running, and a SIGKILL — which the wrapper
 * cannot forward — orphans it for certain. Spawning the child `detached` makes
 * it a group leader, and a negative pid then reaches the wrapper together with
 * everything it started.
 *
 * Returns the failure rather than logging it, so each caller can report it with
 * its own context. ESRCH is swallowed: "the group is already gone" is the
 * expected race when a child exits on its own just before teardown.
 *
 * Caveat for callers: ESRCH is also what a pid that is *not* a group leader
 * returns, and the two cannot be told apart. Spawning `detached` is what makes
 * the pid a leader; a caller that skips it gets a silent no-op, so never treat
 * a null return as proof the group is gone — wait for the child's exit.
 */
export function signalProcessGroup(
  pid: number | undefined,
  signal: "SIGKILL" | "SIGTERM",
): NodeJS.ErrnoException | null {
  if (pid === undefined) {
    return null;
  }

  try {
    process.kill(-pid, signal);

    return null;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;

    return failure.code === "ESRCH" ? null : failure;
  }
}
