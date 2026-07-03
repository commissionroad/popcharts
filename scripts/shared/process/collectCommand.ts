import { spawn } from "node:child_process";

import { writePrefixed } from "./writePrefixed.ts";

/** Exit code and captured output of a finished child command. */
export type CollectedCommand = {
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
};

/**
 * Runs a command to completion while capturing stdout/stderr, optionally
 * echoing every line with an `[echoPrefix]` label as it streams. Throws with
 * the captured output when the command fails and `rejectOnFailure` is set,
 * so callers get the real failure text instead of a bare exit code.
 */
export async function collectCommand(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly echoPrefix?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly rejectOnFailure?: boolean;
  } = {},
): Promise<CollectedCommand> {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stdout += text;
    if (options.echoPrefix) {
      writePrefixed(options.echoPrefix, text);
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;
    if (options.echoPrefix) {
      writePrefixed(options.echoPrefix, text);
    }
  });

  const code = await new Promise<number>((resolveCode, reject) => {
    child.on("error", reject);
    child.on("exit", (exitCode) => resolveCode(exitCode ?? 0));
  });

  if (options.rejectOnFailure && code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${code}.\n${
        stderr || stdout
      }`,
    );
  }

  return { code, stderr, stdout };
}
