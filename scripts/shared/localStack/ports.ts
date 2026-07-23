import {
  localChainEnvFileForSlot,
  localDevIndexerHealthFileForSlot,
} from "../env/localDevEnvFiles.ts";
import { assertValidSlot } from "./assertValidSlot.ts";

/**
 * Base resource values for slot 0 and the per-slot stride, exported as the
 * single source of truth so nothing else hardcodes a port or chain id.
 * `deriveStackResources` offsets each base by the slot (chain id excepted —
 * see below). Slot 0 must equal the historical single-stack defaults, so these
 * numbers are load-bearing: changing one silently moves every stack (ADR 0020).
 */
export const SLOT_PORT_STRIDE = 10;
export const BASE_CHAIN_PORT = 8545;
export const BASE_CHAIN_ID = 31337;
export const BASE_API_PORT = 3001;
export const BASE_APP_PORT = 3000;
export const BASE_REVIEW_PORT = 3002;
export const BASE_RESOLUTION_PORT = 3004;
export const BASE_PC_ADMIN_PORT = 8080;
export const BASE_DATABASE_NAME = "popcharts";

/**
 * The fully-derived set of resources a single local dev stack owns for a given
 * slot: the ports it binds, the devchain it talks to, its Postgres database,
 * the generated env file it writes, and the indexer health marker it waits on.
 * Produced by `deriveStackResources`.
 */
export type StackPorts = {
  slot: number;
  chainPort: number;
  chainId: number;
  apiPort: number;
  appPort: number;
  reviewPort: number;
  resolutionPort: number;
  pcAdminPort: number;
  dbName: string;
  chainRpcHttpUrl: string;
  chainRpcWssUrl: string;
  envFilePath: string;
  indexerHealthFilePath: string;
};

/**
 * Derives every resource a stack on `slot` owns by offsetting the base values
 * by the slot number. Slot 0 reproduces the historical single-stack defaults
 * exactly; higher slots get non-overlapping ports, database, and env file so
 * they run concurrently without collision (ADR 0020). Throws on a negative or
 * non-integer slot.
 */
export function deriveStackResources(slot: number): StackPorts {
  assertValidSlot(slot);

  const chainPort = BASE_CHAIN_PORT + SLOT_PORT_STRIDE * slot;

  return {
    slot,
    chainPort,
    // chainId is intentionally constant across slots: `hardhat node` takes its
    // chainId from network config, not a CLI flag, so every slot's devchain
    // actually reports BASE_CHAIN_ID. Isolation is provided by the per-slot
    // chain port and database. Per-slot chainId is deferred (see ADR 0020).
    chainId: BASE_CHAIN_ID,
    apiPort: BASE_API_PORT + SLOT_PORT_STRIDE * slot,
    appPort: BASE_APP_PORT + SLOT_PORT_STRIDE * slot,
    reviewPort: BASE_REVIEW_PORT + SLOT_PORT_STRIDE * slot,
    resolutionPort: BASE_RESOLUTION_PORT + SLOT_PORT_STRIDE * slot,
    pcAdminPort: BASE_PC_ADMIN_PORT + slot,
    dbName: slot === 0 ? BASE_DATABASE_NAME : `${BASE_DATABASE_NAME}_${slot}`,
    chainRpcHttpUrl: `http://127.0.0.1:${chainPort}`,
    chainRpcWssUrl: `ws://127.0.0.1:${chainPort}`,
    envFilePath: localChainEnvFileForSlot(slot),
    indexerHealthFilePath: localDevIndexerHealthFileForSlot(slot),
  };
}
