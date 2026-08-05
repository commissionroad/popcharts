/**
 * Process seam shared by the headless-CLI model providers in both the AI
 * review and AI resolution services. The two services keep separate provider
 * registries by design, but spawning a CLI and reading its output is the same
 * problem in both, so it lives here rather than being copied per service.
 */

/**
 * Command runner seam so tests can fake a CLI without spawning processes.
 * `stderr` is optional so test fakes can omit it; a real run always captures it
 * because a failing CLI reports why there and nowhere else.
 */
export type CliRunner = (options: {
  argv: string[];
  env: Record<string, string | undefined>;
  timeoutMs: number;
}) => Promise<{ exitCode: number; stderr?: string; stdout: string }>;

/**
 * Failure message for a CLI that exited non-zero. Codex reports the reason only
 * on stderr and leaves stdout empty, so dropping stderr here would leave an
 * exit code as the sole diagnostic.
 */
export function cliExitError(
  label: string,
  exitCode: number,
  stderr: string | undefined,
): Error {
  const detail = stderr?.trim();
  return new Error(
    detail
      ? `${label} exited with code ${exitCode}: ${truncate(detail, 500)}`
      : `${label} exited with code ${exitCode}.`,
  );
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export async function runWithBunSpawn({
  argv,
  env,
  timeoutMs,
}: {
  argv: string[];
  env: Record<string, string | undefined>;
  timeoutMs: number;
}): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const child = Bun.spawn(argv, {
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const timeout = setTimeout(() => child.kill(), timeoutMs);

  try {
    // Both streams are drained concurrently: a CLI that fills one pipe's buffer
    // while nothing reads the other deadlocks instead of exiting.
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const exitCode = await child.exited;
    return { exitCode, stderr, stdout };
  } finally {
    clearTimeout(timeout);
  }
}
