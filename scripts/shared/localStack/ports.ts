import { localChainEnvFile } from "../env/localDevEnvFiles.ts";

export const SLOT_PORT_STRIDE = 10;
export const BASE_CHAIN_PORT = 8545;
export const BASE_CHAIN_ID = 31337;
export const BASE_API_PORT = 3001;
export const BASE_APP_PORT = 3000;
export const BASE_REVIEW_PORT = 3002;
export const BASE_RESOLUTION_PORT = 3004;
export const BASE_PC_ADMIN_PORT = 8080;

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
};

export function deriveStackResources(slot: number): StackPorts {
  if (!Number.isInteger(slot) || slot < 0) {
    throw new Error(`Stack slot must be a non-negative integer; received ${slot}.`);
  }

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
    dbName: slot === 0 ? "popcharts" : `popcharts_${slot}`,
    chainRpcHttpUrl: `http://127.0.0.1:${chainPort}`,
    chainRpcWssUrl: `ws://127.0.0.1:${chainPort}`,
    envFilePath: slot === 0 ? localChainEnvFile : `${localChainEnvFile}.${slot}`,
  };
}
