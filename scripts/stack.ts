#!/usr/bin/env -S node --experimental-strip-types

import { repoRoot } from "./shared/paths.ts";
import {
  OwnStackResolutionError,
  resolveOwnStack,
} from "./shared/localStack/resolveOwnStack.ts";
import {
  pruneDeadDescriptors,
  type StackDescriptor,
} from "./shared/localStack/registry.ts";
import { describeTargetStack } from "./shared/localStack/resolveTargetStack.ts";

/**
 * Control-plane CLI for *this worktree's* local dev stack (ADR 0020).
 *
 * It exists because the process-compose control API has no authentication and
 * no notion of ownership: any caller who names a port commands that stack, and
 * `/project/stop` ends it — taking a `hardhat node` devchain's in-memory state
 * with it, unrecoverably. Twice, a worktree session typed the memorable 8080
 * and stopped the primary checkout's stack instead of its own.
 *
 * The fix is to make the port unspeakable rather than merely discouraged: every
 * command here resolves the port from the registry entry whose `worktreePath`
 * matches this worktree, so there is no argument through which the wrong stack
 * can be named. `--stack`-style selectors are deliberately absent; a caller who
 * genuinely means another stack should run this script from that worktree.
 *
 * Usage:
 *   scripts/stack list
 *   scripts/stack status
 *   scripts/stack stop <process>
 *   scripts/stack start <process>
 *   scripts/stack restart <process>
 *   scripts/stack logs <process> [lines]
 */

type ProcessState = { name: string; status: string };

const USAGE = `Usage: scripts/stack <command> [args]

  list                 every running stack, marking which one is yours
  status               your stack's processes and their states
  stop <process>       stop one process in your stack
  start <process>      start one process in your stack
  restart <process>    restart one process in your stack
  logs <process> [n]   tail n lines (default 50) from one process

Always acts on the stack started from this worktree. There is no flag to
target another one — run this from that worktree instead.`;

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === undefined || command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }

  const liveStacks = await pruneDeadDescriptors();

  if (command === "list") {
    listStacks(liveStacks);
    return;
  }

  const own = resolveOwnStack({ liveStacks, worktreePath: repoRoot });

  switch (command) {
    case "status":
      await printStatus(own);
      return;
    case "stop":
    case "start":
    case "restart":
      await controlProcess(own, command, requireProcessName(args[0], command));
      return;
    case "logs":
      await printLogs(
        own,
        requireProcessName(args[0], command),
        parseLineCount(args[1]),
      );
      return;
    default:
      throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

/** The process name an action needs, or a loud failure naming the command. */
function requireProcessName(
  value: string | undefined,
  command: string,
): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`\`stack ${command}\` needs a process name.\n\n${USAGE}`);
  }

  return value;
}

/** Line count for `logs`, defaulting to 50 and rejecting nonsense loudly. */
function parseLineCount(value: string | undefined): number {
  if (value === undefined) {
    return 50;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Line count must be a positive integer, got "${value}".`);
  }

  return parsed;
}

/**
 * Lists every running stack, marking this worktree's. The foreign entries are
 * shown so an operator can see what else is live — the point of naming them is
 * that they are off limits, which is why no command here can target them.
 */
function listStacks(liveStacks: readonly StackDescriptor[]): void {
  if (liveStacks.length === 0) {
    console.log("No local dev stack is running.");
    return;
  }

  for (const descriptor of liveStacks) {
    const mine = descriptor.worktreePath === repoRoot;
    console.log(
      `${mine ? "*" : " "} control:${descriptor.pcAdminPort} ` +
        `${describeTargetStack(descriptor)}`,
    );
  }

  console.log("\n* = this worktree's stack (the only one this CLI can touch)");
}

/** Calls the control API of `descriptor`'s stack, never any other. */
async function controlApi(
  descriptor: StackDescriptor,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(
    `http://127.0.0.1:${descriptor.pcAdminPort}${path}`,
    init,
  );

  if (!response.ok) {
    throw new Error(
      `Control API ${path} on slot ${descriptor.slot} ` +
        `(port ${descriptor.pcAdminPort}) returned ${response.status}.`,
    );
  }

  return response;
}

async function printStatus(descriptor: StackDescriptor): Promise<void> {
  const response = await controlApi(descriptor, "/processes");
  const payload = (await response.json()) as
    | { data?: ProcessState[] }
    | ProcessState[];
  const states = Array.isArray(payload) ? payload : (payload.data ?? []);

  console.log(
    `slot ${descriptor.slot} (control ${descriptor.pcAdminPort}) — ${descriptor.worktreePath}`,
  );

  for (const state of [...states].sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${state.name.padEnd(20)} ${state.status}`);
  }
}

async function controlProcess(
  descriptor: StackDescriptor,
  command: "restart" | "start" | "stop",
  processName: string,
): Promise<void> {
  // process-compose answers stop on PATCH and the others on POST; sending the
  // wrong verb 404s, which reads like a missing process rather than a wrong
  // method.
  const method = command === "stop" ? "PATCH" : "POST";
  await controlApi(descriptor, `/process/${command}/${processName}`, {
    method,
  });

  console.log(
    `${command} ${processName} on slot ${descriptor.slot} (control ${descriptor.pcAdminPort})`,
  );
}

async function printLogs(
  descriptor: StackDescriptor,
  processName: string,
  lines: number,
): Promise<void> {
  const response = await controlApi(
    descriptor,
    `/process/logs/${processName}/0/${lines}`,
  );
  const payload = (await response.json()) as { logs?: string[] };

  for (const line of payload.logs ?? []) {
    console.log(line);
  }
}

main().catch((error: unknown) => {
  // An ownership failure is the expected outcome of running this from a
  // worktree with no stack, so it prints its own guidance without a stack
  // trace; anything else is a genuine fault.
  if (error instanceof OwnStackResolutionError) {
    console.error(`\n[stack] ${error.message}\n`);
    process.exit(1);
  }

  console.error(
    `\n[stack] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
