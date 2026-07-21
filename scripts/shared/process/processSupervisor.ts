import { spawn } from "node:child_process";

import { sleep } from "../wait/sleep.ts";
import { writePrefixed } from "./writePrefixed.ts";

/**
 * A long-running child tracked by a supervisor. `exited` is the authoritative
 * liveness flag: `code` alone is ambiguous because a signal-terminated child
 * (SIGTERM/SIGKILL — how stop() ends one) exits with `code === null`, the same
 * value it holds while running. Callers that restart a service must consult
 * `exited`, not `code`.
 */
export type SupervisedProcess = {
  readonly child: ReturnType<typeof spawn>;
  code: number | null;
  exited: boolean;
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
  /**
   * Stops a single tracked child (SIGTERM, escalating to SIGKILL after a
   * grace period) and resolves once it has exited. Used by the stack-control
   * surface to bounce one service without tearing down the stack.
   */
  stop: (processInfo: SupervisedProcess) => Promise<void>;
  /**
   * Blocks until one of the given processes exits (then throws) or until a
   * shutdown request terminates the script. Orchestrators call this after
   * startup so an unexpected child death surfaces instead of leaving a
   * half-dead stack running.
   */
  waitForever: (processes: readonly SupervisedProcess[]) => Promise<never>;
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
    const processInfo: SupervisedProcess = {
      child,
      code: null,
      exited: false,
      name,
    };

    children.add(processInfo);
    child.stdout?.on("data", (chunk: Buffer) => {
      writePrefixed(name, chunk.toString());
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      writePrefixed(name, chunk.toString());
    });
    child.on("exit", (code) => {
      processInfo.code = code;
      processInfo.exited = true;
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
      if (processInfo.exited) {
        throw new Error(
          `${processInfo.name} exited before the flow completed (code ${processInfo.code}).`,
        );
      }
    }
  }

  async function waitForever(
    processes: readonly SupervisedProcess[],
  ): Promise<never> {
    for (;;) {
      assertRunning(processes);
      await sleep(1_000);
    }
  }

  async function stop(processInfo: SupervisedProcess): Promise<void> {
    if (processInfo.exited) {
      return;
    }

    const exited = new Promise<void>((resolveStop) => {
      processInfo.child.once("exit", () => resolveStop());
    });
    processInfo.child.kill("SIGTERM");

    // Escalate to SIGKILL if the child ignores SIGTERM (viem watchers can
    // delay a graceful exit), but ALWAYS await the real exit — callers
    // (the stack-control restart path) must be able to trust that the
    // process is gone and `exited` is set when stop() resolves, otherwise a
    // follow-on start() sees it as still running and no-ops.
    void sleep(3_000).then(() => {
      if (!processInfo.exited) {
        processInfo.child.kill("SIGKILL");
      }
    });
    await exited;
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

  return { assertRunning, shutdown, start, stop, waitForever };
}
