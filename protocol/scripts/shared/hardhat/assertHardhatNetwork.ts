import type { PublicClient } from "viem";

/**
 * Confirms Hardhat selected the expected named network and RPC chain.
 */
export async function assertHardhatNetwork({
  expectedChainId,
  expectedNetworkName,
  networkName,
  publicClient,
}: {
  expectedChainId: number;
  expectedNetworkName: string;
  networkName: string;
  publicClient: PublicClient;
}) {
  const chainId = await publicClient.getChainId();

  if (networkName !== expectedNetworkName) {
    throw new Error(`Expected Hardhat network ${expectedNetworkName}, got ${networkName}.`);
  }
  if (chainId !== expectedChainId) {
    throw new Error(`Expected chain ${expectedChainId}, got ${chainId}.`);
  }

  return chainId;
}
