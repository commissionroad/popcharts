import { spawn, type ChildProcess } from "node:child_process";

import { signalProcessGroup } from "../process/signalProcessGroup.ts";

/**
 * Runs a *fixed* set of the repo's own test commands on behalf of the local
 * dashboard (ADR 0017).
 *
 * The page never supplies a command, a path, or an argument — it posts one of
 * these ids and nothing else. That is the whole security model: there is no
 * input that can widen what runs, so the endpoint cannot be turned into
 * arbitrary execution. Commands are spawned without a shell for the same
 * reason.
 */
export interface RunnableCommand {
  id: string;
  label: string;
  /** What the run produces, so the page can say why you'd click it. */
  detail: string;
  command: string;
  args: string[];
}

export const RUNNABLE: RunnableCommand[] = [
  {
    id: "app-coverage",
    label: "app coverage",
    detail: "refreshes app/coverage/lcov.info",
    command: "pnpm",
    args: ["run", "app:coverage"],
  },
  {
    id: "server-coverage",
    label: "server coverage",
    detail: "refreshes server/coverage/lcov.info",
    command: "pnpm",
    args: ["run", "server:coverage"],
  },
  {
    id: "protocol-coverage",
    label: "protocol coverage (Solidity)",
    detail: "refreshes protocol/coverage/lcov.info",
    command: "pnpm",
    args: ["run", "protocol:coverage"],
  },
  {
    id: "protocol-coverage-ts",
    label: "protocol coverage (TS SDK)",
    // No root wrapper exists for the TS figure, so this calls the workspace
    // script directly — the same one protocol CI runs.
    detail: "refreshes protocol/coverage-ts/lcov.info",
    command: "pnpm",
    args: ["--dir", "protocol", "test:coverage:ts"],
  },
  {
    id: "app-test",
    label: "app unit tests",
    detail: "no coverage output",
    command: "pnpm",
    args: ["run", "app:test"],
  },
  {
    id: "server-test",
    label: "server unit tests",
    // There is no root `server:test` wrapper — the workspace runs on bun.
    detail: "no coverage output",
    command: "pnpm",
    args: ["--dir", "server", "test"],
  },
  {
    id: "scripts-test",
    label: "scripts tests",
    detail: "no coverage output",
    command: "pnpm",
    args: ["run", "scripts:test"],
  },
];

export interface RunState {
  id: string | null;
  label: string | null;
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  /** Trailing output, capped — a coverage run prints a lot. */
  lines: string[];
  truncated: boolean;
}

export interface TestRunner {
  start: (id: string) => { ok: true } | { ok: false; reason: string };
  cancel: () => void;
  state: () => RunState;
  /** Resolves when the active run ends, so callers can refresh derived data. */
  onFinished: (listener: () => void) => void;
}

const MAX_LINES = 500;

/**
 * Creates the single-slot runner. One run at a time by design: these commands
 * are heavy, and serialising them keeps the output stream unambiguous and
 * avoids two suites fighting over the same coverage output file.
 */
export function createTestRunner(cwd: string): TestRunner {
  let child: ChildProcess | null = null;
  let state: RunState = {
    id: null,
    label: null,
    running: false,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    lines: [],
    truncated: false,
  };
  const listeners: (() => void)[] = [];

  function push(chunk: string): void {
    for (const line of chunk.split("\n")) {
      if (!line.trim()) continue;
      state.lines.push(line);
    }
    if (state.lines.length > MAX_LINES) {
      state.lines = state.lines.slice(-MAX_LINES);
      state.truncated = true;
    }
  }

  return {
    start(id) {
      if (state.running) return { ok: false, reason: "a run is already active" };
      const runnable = RUNNABLE.find((entry) => entry.id === id);
      if (!runnable) return { ok: false, reason: `unknown command: ${id}` };

      state = {
        id: runnable.id,
        label: runnable.label,
        running: true,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        lines: [`$ ${runnable.command} ${runnable.args.join(" ")}`],
        truncated: false,
      };

      // Detached so cancel() can signal the whole group: these commands are
      // wrappers (pnpm → vitest/hardhat) whose real work is a grandchild.
      child = spawn(runnable.command, runnable.args, {
        cwd,
        detached: true,
        env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", (buffer: Buffer) => push(buffer.toString()));
      child.stderr?.on("data", (buffer: Buffer) => push(buffer.toString()));
      child.on("error", (error) => push(`failed to start: ${String(error)}`));
      child.on("close", (code) => {
        state.running = false;
        state.exitCode = code;
        state.finishedAt = new Date().toISOString();
        child = null;
        for (const listener of listeners) listener();
      });

      return { ok: true };
    },

    cancel() {
      if (!child || !state.running) return;
      push("— cancelled —");
      signalProcessGroup(child.pid, "SIGTERM");
    },

    state() {
      return { ...state, lines: [...state.lines] };
    },

    onFinished(listener) {
      listeners.push(listener);
    },
  };
}
