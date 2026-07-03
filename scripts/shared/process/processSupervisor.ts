import { spawn } from "node:child_process";

import { sleep } from "../wait/sleep.ts";
import { writePrefixed } from "./writePrefixed.ts";

/** A long-running child tracked by a supervisor. `code` is null while alive. */
export type SupervisedProcess = {
  readonly child: ReturnType<typeof spawn>;
  code: number | null;
  readonly name: string;
};

/** Starts, tracks, and tears down a set of long-running child processes. */
export type ProcessSupervisor = {
  /** Throws if any of the given processes has already exited. */
  assertRunning: (processes: readonly SupervisedProcess[]) => void;
  /** Stops all tracked children in reverse start order, then exits. */
  shutdown: (code: number) => Promise<never>;
  /** Spawns a child with prefixed output and tracks it for shutdown. */
  start: (
    name: string,
    command: string,
    args: readonly string[],
    options?: { readonly env?: NodeJS.ProcessEnv },
  ) => SupervisedProcess;
};

/**
 * Creates a supervisor for orchestration scripts that run several services at
 * once (chain node, API, indexer). Children get `[name]`-prefixed output;
 * shutdown stops them in reverse start order so upstream dependencies (the
 * chain) outlive their consumers (the indexer), and SIGTERM escalates to
 * SIGKILL after a grace period so a wedged watcher cannot hang the terminal.
 */
export function createProcessSupervisor(options: {
  readonly cwd: string;
  readonly logLabel: string;
}): ProcessSupervisor {
  const children = new Set<SupervisedProcess>();
  let shuttingDown = false;

  function start(
    name: string,
    command: string,
    args: readonly string[],
    startOptions: { readonly env?: NodeJS.ProcessEnv } = {},
  ): SupervisedProcess {
    console.log(
      `\n[${options.logLabel}] starting ${name}: ${command} ${args.join(" ")}`,
    );
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...startOptions.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const processInfo: SupervisedProcess = { child, code: null, name };

    children.add(processInfo);
    child.stdout?.on("data", (chunk: Buffer) => {
      writePrefixed(name, chunk.toString());
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      writePrefixed(name, chunk.toString());
    });
    child.on("exit", (code) => {
      processInfo.code = code;
      children.delete(processInfo);
    });

    return processInfo;
  }

  function assertRunning(processes: readonly SupervisedProcess[]): void {
    // Children exit on purpose during shutdown; don't report that as failure.
    if (shuttingDown) {
      return;
    }

    for (const processInfo of processes) {
      if (processInfo.code !== null) {
        throw new Error(
          `${processInfo.name} exited before the flow completed (code ${processInfo.code}).`,
        );
      }
    }
  }

  async function stop(processInfo: SupervisedProcess): Promise<void> {
    if (processInfo.code !== null) {
      return;
    }

    processInfo.child.kill("SIGTERM");

    await Promise.race([
      new Promise<void>((resolveStop) => {
        processInfo.child.once("exit", () => resolveStop());
      }),
      sleep(3_000).then(() => {
        if (processInfo.code === null) {
          processInfo.child.kill("SIGKILL");
        }
      }),
    ]);
  }

  async function shutdown(code: number): Promise<never> {
    // A signal handler and a failing main() can both request shutdown; the
    // first request wins and later callers simply wait for the exit.
    if (shuttingDown) {
      return new Promise<never>(() => {});
    }

    shuttingDown = true;

    for (const processInfo of [...children].reverse()) {
      await stop(processInfo);
    }

    process.exit(code);
  }

  return { assertRunning, shutdown, start };
}
