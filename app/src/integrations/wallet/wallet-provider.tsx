"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useState } from "react";
import { WagmiProvider } from "wagmi";

import {
  supportedWalletChains,
  type WalletChainSummary,
} from "@/integrations/wallet/chains";
import { LocalWalletAccountProvider } from "@/integrations/wallet/local-wallet-provider";
import { PrivyWalletAccountProvider } from "@/integrations/wallet/privy-wallet-provider";
import {
  localWalletIntegrationEnabled,
  localWalletWagmiConfig,
  privyAppId,
  privyClientId,
  privyConfig,
  privyWagmiConfig,
  walletIntegrationEnabled,
} from "@/integrations/wallet/wallet-config";
import {
  defaultChainSummary,
  noop,
  noopAsync,
  type WalletConnectionSummary,
  type WalletPendingAction,
} from "@/integrations/wallet/wallet-utilities";

export type { WalletConnectionSummary } from "@/integrations/wallet/wallet-utilities";

export type WalletAccountValue = {
  activeChainId: number | null;
  activeChainName: string | null;
  address: string | null;
  authenticated: boolean;
  clearError: () => void;
  connectOrCreateWallet: () => void;
  copyAddress: () => Promise<void>;
  defaultChain: WalletChainSummary;
  displayAddress: string | null;
  enabled: boolean;
  errorMessage: string | null;
  isSupportedChain: boolean;
  linkWallet: () => void;
  login: () => void;
  loginLabel: string;
  logout: () => Promise<void>;
  pendingAction: WalletPendingAction | null;
  ready: boolean;
  setActiveWallet: (address: string) => Promise<void>;
  supportedChains: readonly WalletChainSummary[];
  switchChain: (chainId: number) => Promise<void>;
  userLabel: string | null;
  wallets: readonly WalletConnectionSummary[];
};

const disabledWalletValue: WalletAccountValue = {
  activeChainId: null,
  activeChainName: null,
  address: null,
  authenticated: false,
  clearError: noop,
  connectOrCreateWallet: noop,
  copyAddress: noopAsync,
  defaultChain: defaultChainSummary,
  displayAddress: null,
  enabled: false,
  errorMessage: null,
  isSupportedChain: false,
  linkWallet: noop,
  login: noop,
  loginLabel: "Sign in",
  logout: noopAsync,
  pendingAction: null,
  ready: true,
  setActiveWallet: noopAsync,
  supportedChains: supportedWalletChains,
  switchChain: noopAsync,
  userLabel: null,
  wallets: [],
};

export const WalletAccountContext =
  createContext<WalletAccountValue>(disabledWalletValue);

export function WalletProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            staleTime: 20_000,
          },
        },
      })
  );

  if (!privyAppId) {
    return (
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={localWalletWagmiConfig}>
          {walletIntegrationEnabled && localWalletIntegrationEnabled ? (
            <LocalWalletAccountProvider>{children}</LocalWalletAccountProvider>
          ) : (
            <WalletAccountContext.Provider value={disabledWalletValue}>
              {children}
            </WalletAccountContext.Provider>
          )}
        </WagmiProvider>
      </QueryClientProvider>
    );
  }

  const privyClientProps = privyClientId ? { clientId: privyClientId } : {};

  return (
    <PrivyProvider appId={privyAppId} config={privyConfig} {...privyClientProps}>
      <QueryClientProvider client={queryClient}>
        <PrivyWagmiProvider config={privyWagmiConfig}>
          <PrivyWalletAccountProvider>{children}</PrivyWalletAccountProvider>
        </PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}

export function useWalletAccount() {
  return useContext(WalletAccountContext);
}
