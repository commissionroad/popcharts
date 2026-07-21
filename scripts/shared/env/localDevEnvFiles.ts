import { resolve } from "node:path";

import { assertValidSlot } from "../localStack/assertValidSlot.ts";
import { appDir, serverDir } from "../paths.ts";

/**
 * Generated server env file (`server/.env.local-chain`) that the local dev
 * orchestrators write after contract deployment and that
 * `local-create-market` and the control-plane API/indexer read back.
 */
export const localChainEnvFile = resolve(serverDir, ".env.local-chain");

/**
 * Returns the generated server env file owned by a stack slot. Slot 0 keeps
 * the legacy filename, while concurrent slots append their number (ADR 0020).
 */
export function localChainEnvFileForSlot(slot: number): string {
  assertValidSlot(slot);
  return slot === 0 ? localChainEnvFile : `${localChainEnvFile}.${slot}`;
}

/**
 * Health marker file the indexer touches once it has recovered missed events
 * and subscribed live. The orchestrators delete it on startup and poll for it
 * to declare the indexer ready. Orchestrators must use the slot-scoped path
 * (`StackPorts.indexerHealthFilePath`), never this constant directly, so
 * concurrent stacks cannot delete or trust each other's marker (ADR 0020).
 */
export const localDevIndexerHealthFile = resolve(
  serverDir,
  ".env.local-dev.indexer-health",
);

/**
 * Returns the indexer health marker owned by a stack slot. Slot 0 keeps the
 * legacy filename, while concurrent slots append their number (ADR 0020).
 */
export function localDevIndexerHealthFileForSlot(slot: number): string {
  assertValidSlot(slot);
  return slot === 0
    ? localDevIndexerHealthFile
    : `${localDevIndexerHealthFile}.${slot}`;
}

/**
 * Next.js app env file (`app/.env.development.local`) that receives the
 * POPCHARTS APP ENV marker block with devchain addresses.
 */
export const appLocalDevEnvFile = resolve(appDir, ".env.development.local");
