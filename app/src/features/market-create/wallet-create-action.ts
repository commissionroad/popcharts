import type { useWalletAccount } from "@/integrations/wallet/wallet-provider";

/**
 * The next step a creator must take before a wallet-signed devchain market
 * creation can be submitted: connect, switch chain, wait, or go ahead.
 * `kind` is "ready" only when the transaction can be signed immediately.
 */
export type WalletCreateAction = {
  disabled: boolean;
  kind: "connect" | "ready" | "switch-chain" | "waiting";
  label: string;
  message: string | null;
  run: () => void;
};

/**
 * Derives the single blocking wallet step for devchain market creation, checked
 * in order: wallet availability, authentication, linked address, chain match,
 * and client readiness. Returns a "ready" action once nothing blocks signing.
 */
export function getWalletCreateAction({
  contractChainId,
  publicClientReady,
  wallet,
  walletClientReady,
}: {
  contractChainId: number | null;
  publicClientReady: boolean;
  wallet: ReturnType<typeof useWalletAccount>;
  walletClientReady: boolean;
}): WalletCreateAction {
  if (!wallet.enabled) {
    return {
      disabled: true,
      kind: "waiting",
      label: "Configure wallet",
      message: "Wallet signing is required for devchain market creation.",
      run: noop,
    };
  }

  if (!wallet.ready) {
    return {
      disabled: true,
      kind: "waiting",
      label: "Preparing wallet",
      message: "Wallet state is still loading.",
      run: noop,
    };
  }

  if (wallet.pendingAction) {
    return {
      disabled: true,
      kind: "waiting",
      label: "Wallet pending...",
      message: "Finish the pending wallet action before creating this market.",
      run: noop,
    };
  }

  if (!wallet.authenticated) {
    return {
      disabled: false,
      kind: "connect",
      label: "Connect wallet",
      message: "Connect a wallet to sign the market creation transaction.",
      run: wallet.login,
    };
  }

  if (!wallet.address) {
    return {
      disabled: false,
      kind: "connect",
      label: "Add wallet",
      message: "Create or link an EVM wallet before creating this market.",
      run: wallet.connectOrCreateWallet,
    };
  }

  if (!contractChainId) {
    return {
      disabled: true,
      kind: "waiting",
      label: "Configure devchain",
      message: "Devchain contract configuration is incomplete.",
      run: noop,
    };
  }

  if (!wallet.isSupportedChain || wallet.activeChainId !== contractChainId) {
    return {
      disabled: false,
      kind: "switch-chain",
      label: `Switch to ${wallet.defaultChain.name}`,
      message: `Switch your wallet to ${wallet.defaultChain.name} before creating this market.`,
      run: () => void wallet.switchChain(contractChainId),
    };
  }

  if (!publicClientReady || !walletClientReady) {
    return {
      disabled: true,
      kind: "waiting",
      label: "Preparing wallet",
      message: "Waiting for the connected wallet client.",
      run: noop,
    };
  }

  return {
    disabled: false,
    kind: "ready",
    label: "Create market",
    message: "Your connected wallet will sign this devchain transaction.",
    run: noop,
  };
}

function noop() {}
