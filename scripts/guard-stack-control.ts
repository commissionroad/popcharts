#!/usr/bin/env -S node --experimental-strip-types

import { slotForControlPort } from "./shared/localStack/ports.ts";
import { pruneDeadDescriptors } from "./shared/localStack/registry.ts";
import { repoRoot } from "./shared/paths.ts";

/**
 * Agent guard: refuses a shell command that would drive another worktree's
 * process-compose control API (ADR 0020).
 *
 * Third and last layer behind the strided control ports and `scripts/stack`.
 * Those two make the mistake unlikely and inconvenient; this one makes it
 * impossible for an agent that has forgotten both — which is the actual
 * observed failure. The control API has no authentication, `/project/stop`
 * ends a whole stack, and a `hardhat node` devchain keeps its state in memory,
 * so one wrong port is unrecoverable data loss for whoever owns that stack.
 *
 * Reads a PreToolUse hook payload on stdin and exits 2 to block, 0 to allow.
 * Wired for Claude Code in `.claude/settings.json`; the logic lives here so
 * another harness can call the same script.
 */

/** A control-plane call found in a command, with the port it addresses. */
export type ControlPortReference = {
  /** The port the command addresses. */
  port: number;
  /** The matched text, quoted back to the agent so the block is legible. */
  evidence: string;
};

/**
 * Finds process-compose control-plane calls in a shell command.
 *
 * Matches the two shapes that actually reach the API: an HTTP URL naming a
 * loopback host and port (curl, wget, httpie), and `process-compose` with an
 * explicit `-p`/`--port`. Deliberately keyed on the port rather than on the
 * verb: `/project/stop` is the destructive one, but a `stop`/`restart` aimed at
 * a foreign stack is already wrong, and matching verbs would need to keep pace
 * with the API's surface.
 *
 * Ports outside the control-port grid are ignored — this must not intercept an
 * ordinary API (3001) or app (3000) request.
 */
export function findControlPortReferences(
  command: string,
): ControlPortReference[] {
  const references: ControlPortReference[] = [];
  // Loopback host, then the port. Hosts are spelled out rather than matched
  // loosely so a URL like example.com:8080 (not ours) never trips the guard.
  const urlPattern =
    /https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]):(\d{2,5})/g;
  // `process-compose … -p 8080` / `--port=8080`, in either order of flags.
  const cliPattern = /process-compose[^\n]*?(?:-p|--port)[= ]+(\d{2,5})/g;

  for (const pattern of [urlPattern, cliPattern]) {
    for (const match of command.matchAll(pattern)) {
      const port = Number(match[1]);

      if (slotForControlPort(port) !== undefined) {
        references.push({ evidence: match[0], port });
      }
    }
  }

  return references;
}

/**
 * Decides whether `command` may run, given the control port this worktree owns.
 *
 * `ownControlPort` is null when no stack is running here, and then every
 * control port is someone else's — the exact situation in both incidents, where
 * a worktree with no stack of its own commanded the primary checkout's.
 */
export function blockReasonForCommand(options: {
  readonly command: string;
  readonly ownControlPort: number | null;
}): string | null {
  const foreign = findControlPortReferences(options.command).filter(
    (reference) => reference.port !== options.ownControlPort,
  );

  if (foreign.length === 0) {
    return null;
  }

  const ports = [...new Set(foreign.map((reference) => reference.port))];
  const owned =
    options.ownControlPort === null
      ? "This worktree has no running stack, so every control port belongs to someone else."
      : `This worktree's stack is on control port ${options.ownControlPort}.`;

  return (
    `Refusing to drive another worktree's dev stack: ${ports.join(", ")}.\n` +
    `${owned}\n` +
    `The control API is unauthenticated and stopping a stack destroys its ` +
    `devchain state permanently.\n` +
    `Use \`pnpm run local:stack <list|status|stop|start|restart|logs>\`, which ` +
    `resolves your own stack and cannot address another.`
  );
}

/** This worktree's control port, or null when it has no stack running. */
async function readOwnControlPort(): Promise<number | null> {
  const liveStacks = await pruneDeadDescriptors();

  return (
    liveStacks.find((descriptor) => descriptor.worktreePath === repoRoot)
      ?.pcAdminPort ?? null
  );
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  let command: string;

  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      tool_input?: { command?: unknown };
    };
    const raw = payload.tool_input?.command;

    if (typeof raw !== "string") {
      return;
    }

    command = raw;
  } catch {
    // Fail open on an unreadable payload. This guard is the third layer, not
    // the only one, and a parser bug that blocked every shell command would do
    // more damage than the risk it defends against.
    return;
  }

  const reason = blockReasonForCommand({
    command,
    ownControlPort: await readOwnControlPort(),
  });

  if (reason !== null) {
    console.error(reason);
    process.exit(2);
  }
}

// `import.meta.main` is false when a test imports this module, so the guard's
// pure functions stay testable without the process reading stdin.
if (import.meta.main) {
  void main();
}
