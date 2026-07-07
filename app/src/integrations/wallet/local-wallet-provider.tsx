"use client";

import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import {
  defaultEvmChain,
  findSupportedEvmChain,
  isSupportedEvmChainId,
  supportedWalletChains,
} from "@/integrations/wallet/chains";
import {
  WalletAccountContext,
  type WalletAccountValue,
} from "@/integrations/wallet/wallet-provider";
import {
  defaultChainSummary,
  getWalletErrorMessage,
  noopAsync,
  type WalletConnectionSummary,
  type WalletPendingAction,
} from "@/integrations/wallet/wallet-utilities";
import { formatAddress } from "@/lib/format";

export function LocalWalletAccountProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const [pendingAction, setPendingAction] = useState<WalletPendingAction | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeAddress = account.address ?? null;
  const activeChainId = account.chainId ?? null;
  const activeChain = findSupportedEvmChain(activeChainId);
  const isSupportedChain = activeChainId ? isSupportedEvmChainId(activeChainId) : true;

  const runWalletAction = useCallback(
    async (action: WalletPendingAction, task: () => Promise<void>) => {
      setPendingAction(action);
      setErrorMessage(null);

      try {
        await task();
      } catch (error) {
        setErrorMessage(getWalletErrorMessage(error));
      } finally {
        setPendingAction(null);
      }
    },
    []
  );

  const connectWallet = useCallback(
    () =>
      runWalletAction("connect-wallet", async () => {
        const connector = connectors.find((item) => item.type === "injected");

        if (!connector) {
          throw new Error("No injected browser wallet was found.");
        }

        await connectAsync({ chainId: defaultEvmChain.id, connector });
      }),
    [connectAsync, connectors, runWalletAction]
  );

  const copyAddress = useCallback(
    () =>
      runWalletAction("copy-address", async () => {
        if (!activeAddress) {
          throw new Error("No active wallet address to copy.");
        }

        await navigator.clipboard.writeText(activeAddress);
      }),
    [activeAddress, runWalletAction]
  );

  const switchChain = useCallback(
    (chainId: number) =>
      runWalletAction(`switch-chain:${chainId}`, async () => {
        await switchChainAsync({ chainId });
      }),
    [runWalletAction, switchChainAsync]
  );

  const logout = useCallback(
    () => runWalletAction("logout", async () => disconnectAsync()),
    [disconnectAsync, runWalletAction]
  );

  const wallets = useMemo<readonly WalletConnectionSummary[]>(
    () =>
      activeAddress
        ? [
            {
              active: true,
              address: activeAddress,
              chainId: activeChainId,
              displayAddress: formatAddress(activeAddress),
              label: "Browser wallet",
              linked: true,
              walletClientType: "injected",
            },
          ]
        : [],
    [activeAddress, activeChainId]
  );

  const value = useMemo<WalletAccountValue>(
    () => ({
      activeChainId,
      activeChainName: activeChain?.name ?? null,
      address: activeAddress,
      authenticated: Boolean(activeAddress),
      clearError: () => setErrorMessage(null),
      connectOrCreateWallet: connectWallet,
      copyAddress,
      defaultChain: defaultChainSummary,
      displayAddress: activeAddress ? formatAddress(activeAddress) : null,
      enabled: true,
      errorMessage,
      isSupportedChain,
      linkWallet: connectWallet,
      login: connectWallet,
      loginLabel: "Connect wallet",
      logout,
      pendingAction,
      ready: true,
      setActiveWallet: noopAsync,
      supportedChains: supportedWalletChains,
      switchChain,
      userLabel: null,
      wallets,
    }),
    [
      activeAddress,
      activeChain?.name,
      activeChainId,
      connectWallet,
      copyAddress,
      errorMessage,
      isSupportedChain,
      logout,
      pendingAction,
      switchChain,
      wallets,
    ]
  );

  return (
    <WalletAccountContext.Provider value={value}>
      {children}
    </WalletAccountContext.Provider>
  );
}
