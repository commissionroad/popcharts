import type { Chain } from "viem";
import { base, baseSepolia, hardhat } from "viem/chains";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type NetworkId = "local" | "baseSepolia" | "base";

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
  84532: "baseSepolia",
  8453: "base",
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

  return "local";
}

export function getNetworkConfig(networkId = getNetworkId()): NetworkConfig {
  switch (networkId) {
    case "base":
      return createBaseConfig();
    case "baseSepolia":
      return createBaseSepoliaConfig();
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

function createBaseSepoliaConfig(): NetworkConfig {
  return {
    chainId: baseSepolia.id,
    chain: baseSepolia,
    contracts: {
      pregradManager: readAddress([
        "BASE_SEPOLIA_PREGRAD_MANAGER_ADDRESS",
        "PREGRAD_MANAGER_ADDRESS",
      ]),
    },
    databaseUrl: readDatabaseUrl(),
    deployBlock: readBigInt([
      "BASE_SEPOLIA_PREGRAD_MANAGER_DEPLOY_BLOCK",
      "PREGRAD_MANAGER_DEPLOY_BLOCK",
    ]),
    name: "baseSepolia",
    rpcHttpUrl:
      process.env.BASE_SEPOLIA_RPC_HTTP_URL ?? process.env.RPC_HTTP_URL ?? "",
    rpcWssUrl:
      process.env.BASE_SEPOLIA_RPC_WSS_URL ?? process.env.RPC_WSS_URL ?? "",
  };
}

function createBaseConfig(): NetworkConfig {
  return {
    chainId: base.id,
    chain: base,
    contracts: {
      pregradManager: readAddress([
        "BASE_PREGRAD_MANAGER_ADDRESS",
        "PREGRAD_MANAGER_ADDRESS",
      ]),
    },
    databaseUrl: readDatabaseUrl(),
    deployBlock: readBigInt([
      "BASE_PREGRAD_MANAGER_DEPLOY_BLOCK",
      "PREGRAD_MANAGER_DEPLOY_BLOCK",
    ]),
    name: "base",
    rpcHttpUrl: process.env.BASE_RPC_HTTP_URL ?? process.env.RPC_HTTP_URL ?? "",
    rpcWssUrl: process.env.BASE_RPC_WSS_URL ?? process.env.RPC_WSS_URL ?? "",
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
  return (
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5433/popcharts"
  );
}

function isNetworkId(value: string): value is NetworkId {
  return value === "local" || value === "baseSepolia" || value === "base";
}
