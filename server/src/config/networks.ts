import type { Chain } from "viem";
import { hardhat } from "viem/chains";

import {
  arcTestnet,
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC_HTTP_URL,
  ARC_TESTNET_RPC_WSS_URL,
} from "./arc-testnet";
import { getDatabaseConnectionString } from "./database";

/** Sentinel for "no address configured"; config validation rejects it. */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** The networks the server knows how to run against. */
export type NetworkId = "local" | "arcTestnet";

/** Protocol contract addresses the server needs on the selected network. */
export type ContractAddresses = {
  /** Shared bounded prediction hook; ZERO_ADDRESS when no venue is deployed. */
  boundedHook: `0x${string}`;
  /** Bounded pool order manager; ZERO_ADDRESS when no venue is deployed. */
  orderManager: `0x${string}`;
  /** v4 pool manager; ZERO_ADDRESS when no venue is deployed. */
  poolManager: `0x${string}`;
  /** Per-pool tick bounds registry; ZERO_ADDRESS when no venue is deployed. */
  poolTickBounds: `0x${string}`;
  /** Adapter dev graduation finalizes with; ZERO_ADDRESS when unconfigured. */
  postgradAdapter: `0x${string}`;
  pregradManager: `0x${string}`;
  /** v4 state view lens; ZERO_ADDRESS when no venue is deployed. */
  stateView: `0x${string}`;
  /** Minimal v4 swap/liquidity router; ZERO_ADDRESS when no venue is deployed. */
  swapRouter: `0x${string}`;
};

/**
 * Everything network-specific the API and indexer need: chain identity, RPC
 * endpoints, contract addresses, the deploy block that bounds event recovery
 * scans, and the database URL.
 */
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

/** Maps chain ids to network ids so CHAIN_ID alone can select a network. */
export const chainIdToNetwork: Record<number, NetworkId> = {
  31337: "local",
  [ARC_TESTNET_CHAIN_ID]: "arcTestnet",
};

/**
 * Selects the active network: NETWORK wins, then a recognized CHAIN_ID, and
 * anything else falls back to arcTestnet so an unset environment targets the
 * shared testnet rather than a local chain.
 */
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

/**
 * Builds the full NetworkConfig for a network id, reading network-prefixed
 * env vars (e.g. LOCAL_*, ARC_TESTNET_*) before their generic fallbacks.
 */
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
      boundedHook: readAddress([
        "LOCAL_BOUNDED_HOOK_ADDRESS",
        "BOUNDED_HOOK_ADDRESS",
      ]),
      orderManager: readAddress([
        "LOCAL_ORDER_MANAGER_ADDRESS",
        "ORDER_MANAGER_ADDRESS",
      ]),
      poolManager: readAddress([
        "LOCAL_POOL_MANAGER_ADDRESS",
        "POOL_MANAGER_ADDRESS",
      ]),
      poolTickBounds: readAddress([
        "LOCAL_POOL_TICK_BOUNDS_ADDRESS",
        "POOL_TICK_BOUNDS_ADDRESS",
      ]),
      postgradAdapter: readAddress([
        "LOCAL_POSTGRAD_ADAPTER_ADDRESS",
        "POSTGRAD_ADAPTER_ADDRESS",
      ]),
      pregradManager: readAddress([
        "LOCAL_PREGRAD_MANAGER_ADDRESS",
        "PREGRAD_MANAGER_ADDRESS",
      ]),
      stateView: readAddress([
        "LOCAL_STATE_VIEW_ADDRESS",
        "STATE_VIEW_ADDRESS",
      ]),
      swapRouter: readAddress([
        "LOCAL_SWAP_ROUTER_ADDRESS",
        "SWAP_ROUTER_ADDRESS",
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
      boundedHook: readAddress([
        "ARC_TESTNET_BOUNDED_HOOK_ADDRESS",
        "BOUNDED_HOOK_ADDRESS",
      ]),
      orderManager: readAddress([
        "ARC_TESTNET_ORDER_MANAGER_ADDRESS",
        "ORDER_MANAGER_ADDRESS",
      ]),
      poolManager: readAddress([
        "ARC_TESTNET_POOL_MANAGER_ADDRESS",
        "POOL_MANAGER_ADDRESS",
      ]),
      poolTickBounds: readAddress([
        "ARC_TESTNET_POOL_TICK_BOUNDS_ADDRESS",
        "POOL_TICK_BOUNDS_ADDRESS",
      ]),
      postgradAdapter: readAddress([
        "ARC_TESTNET_POSTGRAD_ADAPTER_ADDRESS",
        "POSTGRAD_ADAPTER_ADDRESS",
      ]),
      pregradManager: readAddress([
        "ARC_TESTNET_PREGRAD_MANAGER_ADDRESS",
        "PREGRAD_MANAGER_ADDRESS",
      ]),
      stateView: readAddress([
        "ARC_TESTNET_STATE_VIEW_ADDRESS",
        "STATE_VIEW_ADDRESS",
      ]),
      swapRouter: readAddress([
        "ARC_TESTNET_SWAP_ROUTER_ADDRESS",
        "SWAP_ROUTER_ADDRESS",
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
