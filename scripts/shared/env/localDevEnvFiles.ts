import { resolve } from "node:path";

import { appDir, serverDir } from "../paths.ts";

/**
 * Generated server env file (`server/.env.local-chain`) that the local dev
 * orchestrators write after contract deployment and that
 * `local-create-market` and the control-plane API/indexer read back.
 */
export const localChainEnvFile = resolve(serverDir, ".env.local-chain");

/**
 * Health marker file the indexer touches once it has recovered missed events
 * and subscribed live. The orchestrators delete it on startup and poll for it
 * to declare the indexer ready.
 */
export const localDevIndexerHealthFile = resolve(
  serverDir,
  ".env.local-dev.indexer-health",
);

/**
 * Next.js app env file (`app/.env.development.local`) that receives the
 * POPCHARTS APP ENV marker block with devchain addresses.
 */
export const appLocalDevEnvFile = resolve(appDir, ".env.development.local");
