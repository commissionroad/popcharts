import { createPublicClient, createWalletClient, http } from "viem";

/**
 * Creates paired viem public and wallet clients for a configured RPC endpoint.
 */
export function createViemClients({ account, chain, rpcUrl }) {
  return {
    publicClient: createPublicClient({
      transport: http(rpcUrl),
    }),
    walletClient: createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    }),
  };
}
