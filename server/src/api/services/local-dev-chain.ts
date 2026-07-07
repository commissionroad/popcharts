import type { BlockchainClient } from "src/blockchain/client";
import { config } from "src/config";

const DEFAULT_HARDHAT_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/**
 * Shared plumbing for dev-only services that drive the local Hardhat chain:
 * the dev signing key, raw local RPC calls, and block-time fast-forwarding.
 * Nothing here is safe for live networks; callers must gate on dev tools
 * being enabled for the local network.
 */

/** Resolves the dev signing key, defaulting to the first Hardhat account. */
export function readDevPrivateKey(): `0x${string}` {
  const value =
    process.env.POPCHARTS_DEVCHAIN_PRIVATE_KEY ??
    process.env.POPCHARTS_DEPLOYER_PRIVATE_KEY ??
    DEFAULT_HARDHAT_PRIVATE_KEY;

  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      "POPCHARTS_DEVCHAIN_PRIVATE_KEY must be a 32-byte hex key.",
    );
  }

  return value as `0x${string}`;
}

/**
 * Moves the next block's timestamp to `targetTimestamp` when the chain has
 * not reached it yet. The next transaction to land mines that block, so the
 * jump only takes effect together with a subsequent write.
 */
export async function fastForwardLocalRpc(
  publicClient: BlockchainClient,
  targetTimestamp: bigint,
) {
  const latestBlock = await publicClient.getBlock();

  if (latestBlock.timestamp >= targetTimestamp) {
    return;
  }

  await requestLocalRpc("evm_setNextBlockTimestamp", [Number(targetTimestamp)]);
}

/** Sends a raw JSON-RPC request to the configured local chain. */
export async function requestLocalRpc(method: string, params: unknown[]) {
  const response = await fetch(config.rpcHttpUrl, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method,
      params,
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
  const body = (await response.json()) as {
    error?: {
      message?: string;
    };
  };

  if (!response.ok || body.error) {
    throw new Error(
      body.error?.message ?? `${method} failed with HTTP ${response.status}`,
    );
  }
}

/** Reads the latest local block timestamp as a Date. */
export async function getLatestBlockTimestamp(publicClient: BlockchainClient) {
  const block = await publicClient.getBlock();

  return new Date(Number(block.timestamp) * 1000);
}
