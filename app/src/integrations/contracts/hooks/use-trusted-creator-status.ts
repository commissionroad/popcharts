import { useReadContract } from "wagmi";

import {
  getPopChartsContractConfig,
  marketCreationMode,
  marketCreationSigner,
} from "../config";
import { pregradManagerAbi } from "../pregrad-manager";

/**
 * Reads whether the given wallet is a trusted market creator on the
 * configured PregradManager. Only enabled for wallet-signed devchain market
 * creation, and only once a contract config and wallet address are available.
 * Returns the wagmi query result.
 */
export function useTrustedCreatorStatus({
  walletAddress,
}: {
  walletAddress: string | null;
}) {
  const contractConfig = getPopChartsContractConfig();

  return useReadContract({
    abi: pregradManagerAbi,
    address: contractConfig?.pregradManagerAddress,
    args: walletAddress ? [walletAddress as `0x${string}`] : undefined,
    chainId: contractConfig?.chainId,
    functionName: "isTrustedCreator",
    query: {
      enabled:
        marketCreationMode === "devchain" &&
        marketCreationSigner === "wallet" &&
        Boolean(contractConfig?.pregradManagerAddress && walletAddress),
    },
  });
}
