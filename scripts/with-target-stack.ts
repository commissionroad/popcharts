#!/usr/bin/env -S node --experimental-strip-types

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readEnvFile } from "./shared/env/readEnvFile.ts";
import { deriveStackResources } from "./shared/localStack/ports.ts";
import { resolveProtocolChainEnv } from "./shared/localStack/protocolChainEnv.ts";
import { pruneDeadDescriptors, type StackDescriptor } from "./shared/localStack/registry.ts";
import { promptForStack } from "./shared/localStack/promptForStack.ts";
import {
  resolveTargetStack,
  TargetStackResolutionError,
} from "./shared/localStack/resolveTargetStack.ts";

/**
 * Launcher that runs a stack-targeting command (a cross-workspace `bun` or
 * `hardhat` script that reads env vars rather than the registry) against a
 * chosen local dev stack (ADR 0020 Phase 5). It resolves the target the same
 * way `local-create-market` does — explicit `--stack <slot|id>` /
 * `POPCHARTS_STACK` wins, one running stack is used directly, several prompt on
 * a TTY — then exports that slot's env vars and execs the wrapped command.
 *
 * Usage: `node scripts/with-target-stack.ts [--stack <slot|id>] -- <cmd> [args…]`
 */

type LauncherArgs = {
  readonly stackToken: string | undefined;
  readonly command: readonly string[];
};

/**
 * Splits the launcher's own `--stack <token>` option from the wrapped command,
 * which is everything after the `--` separator. Throws when no command is
 * given so the recipe fails loudly rather than silently doing nothing.
 */
export function parseLauncherArgs(argv: readonly string[]): LauncherArgs {
  const separator = argv.indexOf("--");
  const own = separator === -1 ? argv : argv.slice(0, separator);
  const command = separator === -1 ? [] : argv.slice(separator + 1);

  let stackToken: string | undefined;
  for (let i = 0; i < own.length; i += 1) {
    const arg = own[i];
    if (arg === "--stack") {
      stackToken = own[i + 1];
      i += 1;
    } else if (arg?.startsWith("--stack=")) {
      stackToken = arg.slice("--stack=".length);
    }
  }

  if (command.length === 0) {
    throw new Error(
      "with-target-stack: no command to run. " +
        "Usage: with-target-stack.ts [--stack <slot|id>] -- <cmd> [args…]",
    );
  }

  return { stackToken, command };
}

/**
 * The environment overrides that point a wrapped command at `target`. Merges
 * the slot's generated env file (which already carries `DATABASE_URL` and the
 * deployed addresses), the chain-selecting variables from
 * `resolveProtocolChainEnv`, and the remaining aliases consumers read:
 * `POPCHARTS_LOCAL_CHAIN_ENV_FILE` (bot-trade), `RPC_WSS_URL`, and
 * `LOCAL_API_PORT`.
 *
 * `POPCHARTS_STACK_SLOT` names the slot itself, so a child that derives its own
 * resources through `readSlotFromEnv` lands on the slot the launcher resolved
 * rather than silently falling back to slot 0 (ADR 0020: a slot leak hides in
 * the env of a spawned child, not in the resolver that chose the slot).
 */
export function targetStackEnv(
  target: StackDescriptor,
): Record<string, string> {
  const fileEnv = existsSync(target.envFilePath)
    ? readEnvFile(target.envFilePath)
    : {};
  // Re-derive the URLs from the slot so the `http://127.0.0.1:<port>` format
  // has one source of truth (ports.ts), not a copy here.
  const { chainRpcWssUrl } = deriveStackResources(target.slot);
  return {
    ...fileEnv,
    POPCHARTS_STACK_SLOT: String(target.slot),
    POPCHARTS_LOCAL_CHAIN_ENV_FILE: target.envFilePath,
    // The chain-selecting variables have one definition, shared with
    // local-create-market's own spawn path.
    ...resolveProtocolChainEnv(fileEnv, target),
    RPC_WSS_URL: chainRpcWssUrl,
    LOCAL_API_PORT: String(target.apiPort),
  };
}

async function main(): Promise<void> {
  const { stackToken, command } = parseLauncherArgs(process.argv.slice(2));

  const live = await pruneDeadDescriptors();
  const target = await resolveTargetStack({
    liveStacks: live,
    token: stackToken ?? process.env.POPCHARTS_STACK,
    chooseStack: process.stdin.isTTY ? promptForStack : undefined,
  });

  console.log(
    `[with-target-stack] targeting slot ${target.slot} (${target.kind}) ` +
      `chain:${target.chainPort} api:${target.apiPort} db:${target.dbName}`,
  );

  const [cmd, ...cmdArgs] = command;
  const child = spawn(cmd!, cmdArgs, {
    stdio: "inherit",
    env: { ...process.env, ...targetStackEnv(target) },
  });
  child.on("exit", (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

/** True when this module is the entry point, not imported (e.g. by tests). */
function isMainModule(): boolean {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === process.argv[1]
  );
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    if (error instanceof TargetStackResolutionError) {
      console.error(error.message);
      process.exit(1);
    }
    console.error(
      `[with-target-stack] ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  });
}
