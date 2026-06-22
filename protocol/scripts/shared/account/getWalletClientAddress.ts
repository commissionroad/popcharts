import { getAddress, type Address } from "viem";

type WalletClientWithOptionalAccount = {
  account?: {
    address?: Address | string;
  };
};

/**
 * Extracts and normalizes the account Hardhat attached to a wallet client.
 */
export function getWalletClientAddress({
  missingMessage,
  walletClient,
}: {
  missingMessage: string;
  walletClient: WalletClientWithOptionalAccount | undefined;
}) {
  if (walletClient?.account?.address === undefined) {
    throw new Error(missingMessage);
  }

  return getAddress(walletClient.account.address);
}
