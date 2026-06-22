import type { Chain } from "viem";
import { hardhat } from "viem/chains";

import {
  arcTestnet,
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC_HTTP_URL,
  ARC_TESTNET_RPC_WSS_URL,
} from "./arc-testnet";
import { getDatabaseConnectionString } from "./database";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type NetworkId = "local" | "arcTestnet";

export type ContractAddresses = {
  pregradManager: `0x${string}`;
};

export type NetworkConfig = {
  chainId: number;
  chain: Chain;
  contracts: ContractAddresses;
  databaseUrl: string;
  deployBlock: bigint;
  name: NetworkId;
  rpcHttpUrl: string;
  rpcWssUrl: string;
};

export const chainIdToNetwork: Record<number, NetworkId> = {
  31337: "local",
  [ARC_TESTNET_CHAIN_ID]: "arcTestnet",
};

export function getNetworkId(): NetworkId {
  const networkEnv = process.env.NETWORK;
  if (networkEnv && isNetworkId(networkEnv)) {
    return networkEnv;
  }

  const chainIdEnv = process.env.CHAIN_ID;
  if (chainIdEnv) {
    const chainId = Number.parseInt(chainIdEnv, 10);
    const network = chainIdToNetwork[chainId];
    if (network) {
      return network;
    }
  }

  return "arcTestnet";
}

export function getNetworkConfig(networkId = getNetworkId()): NetworkConfig {
  switch (networkId) {
    case "arcTestnet":
      return createArcTestnetConfig();
    case "local":
      return createLocalConfig();
  }
}

function createLocalConfig(): NetworkConfig {
  return {
    chainId: hardhat.id,
    chain: hardhat,
    contracts: {
      pregradManager: readAddress([
        "LOCAL_PREGRAD_MANAGER_ADDRESS",
        "PREGRAD_MANAGER_ADDRESS",
      ]),
    },
    databaseUrl: readDatabaseUrl(),
    deployBlock: readBigInt([
      "LOCAL_PREGRAD_MANAGER_DEPLOY_BLOCK",
      "PREGRAD_MANAGER_DEPLOY_BLOCK",
    ]),
    name: "local",
    rpcHttpUrl:
      process.env.LOCAL_RPC_HTTP_URL ??
      process.env.RPC_HTTP_URL ??
      "http://localhost:8545",
    rpcWssUrl:
      process.env.LOCAL_RPC_WSS_URL ??
      process.env.RPC_WSS_URL ??
      "ws://localhost:8545",
  };
}

function createArcTestnetConfig(): NetworkConfig {
  return {
    chainId: arcTestnet.id,
    chain: arcTestnet,
    contracts: {
      pregradManager: readAddress([
        "ARC_TESTNET_PREGRAD_MANAGER_ADDRESS",
        "PREGRAD_MANAGER_ADDRESS",
      ]),
    },
    databaseUrl: readDatabaseUrl(),
    deployBlock: readBigInt([
      "ARC_TESTNET_PREGRAD_MANAGER_DEPLOY_BLOCK",
      "PREGRAD_MANAGER_DEPLOY_BLOCK",
    ]),
    name: "arcTestnet",
    rpcHttpUrl:
      process.env.ARC_TESTNET_RPC_HTTP_URL ?? ARC_TESTNET_RPC_HTTP_URL,
    rpcWssUrl: process.env.ARC_TESTNET_RPC_WSS_URL ?? ARC_TESTNET_RPC_WSS_URL,
  };
}

function readAddress(names: string[]): `0x${string}` {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value as `0x${string}`;
    }
  }

  return ZERO_ADDRESS;
}

function readBigInt(names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return BigInt(value);
    }
  }

  return 0n;
}

function readDatabaseUrl() {
  return getDatabaseConnectionString();
}

function isNetworkId(value: string): value is NetworkId {
  return value === "local" || value === "arcTestnet";
}
