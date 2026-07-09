import type { ConnectedWallet } from "@privy-io/react-auth";

import { defaultEvmChain } from "@/integrations/wallet/chains";
import { presentError } from "@/lib/error-handling";
import { formatAddress } from "@/lib/format";

export type WalletPendingAction =
  | "connect-wallet"
  | "copy-address"
  | "link-wallet"
  | "logout"
  | `set-active:${string}`
  | `switch-chain:${number}`;

export type WalletConnectionSummary = {
  active: boolean;
  address: string;
  chainId: number | null;
  displayAddress: string;
  label: string;
  linked: boolean;
  walletClientType: string;
};

export const noop = () => undefined;
export const noopAsync = async () => undefined;

export const defaultChainSummary = {
  id: defaultEvmChain.id,
  name: defaultEvmChain.name,
};

export function findWalletByAddress(
  wallets: readonly ConnectedWallet[],
  address: string | null | undefined
) {
  if (!address) {
    return undefined;
  }

  const normalizedAddress = address.toLowerCase();

  return wallets.find((wallet) => wallet.address.toLowerCase() === normalizedAddress);
}

export function parseEip155ChainId(chainId: string | undefined) {
  if (!chainId?.startsWith("eip155:")) {
    return null;
  }

  const parsed = Number.parseInt(chainId.replace("eip155:", ""), 10);

  return Number.isFinite(parsed) ? parsed : null;
}

export function summarizeWallet(
  wallet: ConnectedWallet,
  activeAddress: string | null | undefined
): WalletConnectionSummary {
  const normalizedActiveAddress = activeAddress?.toLowerCase();

  return {
    active:
      Boolean(normalizedActiveAddress) &&
      wallet.address.toLowerCase() === normalizedActiveAddress,
    address: wallet.address,
    chainId: parseEip155ChainId(wallet.chainId),
    displayAddress: formatAddress(wallet.address),
    label: wallet.meta.name || formatWalletClientType(wallet.walletClientType),
    linked: wallet.linked,
    walletClientType: wallet.walletClientType,
  };
}

function formatWalletClientType(walletClientType: string) {
  return walletClientType
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const WALLET_ERROR_FALLBACK = "Wallet action failed. Try again from your wallet.";

export function getWalletErrorMessage(error: unknown) {
  return presentError(error, {
    context: { operation: "wallet-action" },
    fallback: WALLET_ERROR_FALLBACK,
  });
}
