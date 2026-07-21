import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Environment bootstrap for the lifecycle nightly runner. The orchestrator
 * (scripts/local-lifecycle-nightly.ts) passes the full stack environment to
 * the child process; when the runner is started standalone against an
 * already-running stack, the stack-generated env file fills any missing keys.
 *
 * This module must be imported before anything that reads src/config —
 * config resolves process.env at import time.
 */

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const envFile =
  process.env.POPCHARTS_LOCAL_CHAIN_ENV_FILE ??
  resolve(serverDir, ".env.local-chain");

// PREGRAD_MANAGER_ADDRESS doubles as the "orchestrator already provided the
// stack env" sentinel: it is always set by the env builders and never has a
// useful default.
if (!process.env.PREGRAD_MANAGER_ADDRESS && existsSync(envFile)) {
  for (const [key, value] of Object.entries(readEnvFile(envFile))) {
    process.env[key] ??= value;
  }
  console.log(`[lifecycle] loaded stack env from ${envFile}`);
}

// Matches scripts/shared/env/readEnvFile.ts, which lives outside this
// package's typecheck root (same deliberate duplication as
// server/scripts/bot-trade.ts).
function readEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    env[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }

  return env;
}
