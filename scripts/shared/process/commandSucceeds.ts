import { collectCommand } from "./collectCommand.ts";

/**
 * Runs a command quietly and reports only whether it exited 0. Intended for
 * readiness polling (e.g. `pg_isready`) where failures are expected and
 * should not print or throw.
 */
export async function commandSucceeds(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): Promise<boolean> {
  const result = await collectCommand(command, args, {
    cwd: options.cwd,
    env: options.env,
  });

  return result.code === 0;
}
