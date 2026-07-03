import { createPublicClient, createWalletClient, http } from "viem";
import type { Account, Chain, PublicClient, Transport, WalletClient } from "viem";

/**
 * Creates paired viem public and wallet clients for a configured RPC endpoint.
 */
export function createViemClients({
  account,
  chain,
  rpcUrl,
}: {
  account: Account;
  chain: Chain;
  rpcUrl: string;
}): {
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, Account>;
} {
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
