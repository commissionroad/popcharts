/**
 * Environment bootstrap for the lifecycle nightly runner. The orchestrator
 * (scripts/local-lifecycle-nightly.ts) passes the full stack environment to
 * the child process; when the runner is started standalone against an
 * already-running stack, the stack-generated env file fills any missing keys.
 *
 * This module must be imported before anything that reads src/config —
 * config resolves process.env at import time.
 */

import { existsSync } from "node:fs";

// Relative path, not a package import: scripts/ is not a workspace package, and
// its node --experimental-strip-types runtime cannot load TS out of
// node_modules, so the repo's shared env helpers are imported by path instead.
import { localChainEnvFile } from "../../../scripts/shared/env/localDevEnvFiles.ts";
import { readEnvFile } from "../../../scripts/shared/env/readEnvFile.ts";

const envFile = process.env.POPCHARTS_LOCAL_CHAIN_ENV_FILE ?? localChainEnvFile;

// PREGRAD_MANAGER_ADDRESS doubles as the "orchestrator already provided the
// stack env" sentinel: it is always set by the env builders and never has a
// useful default.
if (!process.env.PREGRAD_MANAGER_ADDRESS && existsSync(envFile)) {
  for (const [key, value] of Object.entries(readEnvFile(envFile))) {
    process.env[key] ??= value;
  }
  console.log(`[lifecycle] loaded stack env from ${envFile}`);
}
