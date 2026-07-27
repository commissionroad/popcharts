import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Relative path, not a package import: scripts/ is not a workspace package, and
// its own runtime (node --experimental-strip-types) cannot load TS out of
// node_modules, so the one parse body has to be shared by path. parseEnvFile is
// deliberately dependency-free so every runtime that reaches it can load it.
// No `.ts` suffix on the specifier: server resolves modules as a bundler and
// rejects it, while scripts/ requires it — the asymmetry is expected.
import { parseEnvFile } from "../../../scripts/shared/env/parseEnvFile";

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
  for (const [key, value] of Object.entries(
    parseEnvFile(readFileSync(envFile, "utf8")),
  )) {
    process.env[key] ??= value;
  }
  console.log(`[lifecycle] loaded stack env from ${envFile}`);
}
