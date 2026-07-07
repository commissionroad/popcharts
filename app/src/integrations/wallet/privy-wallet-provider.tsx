"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import {
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
  findWalletByAddress,
  getWalletErrorMessage,
  parseEip155ChainId,
  summarizeWallet,
  type WalletPendingAction,
} from "@/integrations/wallet/wallet-utilities";
import { formatAddress } from "@/lib/format";

export function PrivyWalletAccountProvider({ children }: { children: ReactNode }) {
  const {
    authenticated,
    connectOrCreateWallet,
    linkWallet,
    login,
    logout,
    ready: privyReady,
    user,
  } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const account = useAccount();
  const { setActiveWallet } = useSetActiveWallet();
  const [pendingAction, setPendingAction] = useState<WalletPendingAction | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const ready = privyReady && walletsReady;
  const activeAddress = account.address ?? wallets[0]?.address ?? null;
  const activeWallet = useMemo(
    () => findWalletByAddress(wallets, activeAddress) ?? wallets[0],
    [activeAddress, wallets]
  );
  const activeChainId =
    account.chainId ?? parseEip155ChainId(activeWallet?.chainId) ?? null;
  const activeChain = findSupportedEvmChain(activeChainId);
  const isSupportedChain = activeChainId ? isSupportedEvmChainId(activeChainId) : true;
  const userLabel =
    activeAddress ??
    user?.email?.address ??
    user?.google?.email ??
    user?.google?.name ??
    null;

  const walletSummaries = useMemo(
    () =>
      wallets.map((wallet) =>
        summarizeWallet(wallet, activeWallet?.address ?? activeAddress)
      ),
    [activeAddress, activeWallet?.address, wallets]
  );

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

  const handleLogin = useCallback(() => {
    setErrorMessage(null);
    login();
  }, [login]);

  const handleConnectOrCreateWallet = useCallback(() => {
    setErrorMessage(null);
    connectOrCreateWallet();
  }, [connectOrCreateWallet]);

  const handleLinkWallet = useCallback(() => {
    setPendingAction("link-wallet");
    setErrorMessage(null);
    linkWallet({
      description: "Link another EVM wallet to your Pop Charts account.",
      walletChainType: "ethereum-only",
    });
    window.setTimeout(() => setPendingAction(null), 500);
  }, [linkWallet]);

  const handleLogout = useCallback(
    () => runWalletAction("logout", logout),
    [logout, runWalletAction]
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
        if (!activeWallet) {
          login();
          return;
        }

        await activeWallet.switchChain(chainId);
      }),
    [activeWallet, login, runWalletAction]
  );

  const selectActiveWallet = useCallback(
    (address: string) =>
      runWalletAction(`set-active:${address}`, async () => {
        const wallet = findWalletByAddress(wallets, address);

        if (!wallet) {
          throw new Error("That wallet is no longer connected.");
        }

        await setActiveWallet(wallet);
      }),
    [runWalletAction, setActiveWallet, wallets]
  );

  const value = useMemo<WalletAccountValue>(
    () => ({
      activeChainId,
      activeChainName: activeChain?.name ?? null,
      address: activeAddress,
      authenticated,
      clearError: () => setErrorMessage(null),
      connectOrCreateWallet: handleConnectOrCreateWallet,
      copyAddress,
      defaultChain: defaultChainSummary,
      displayAddress: activeAddress ? formatAddress(activeAddress) : null,
      enabled: true,
      errorMessage,
      isSupportedChain,
      linkWallet: handleLinkWallet,
      login: handleLogin,
      loginLabel: "Sign in",
      logout: handleLogout,
      pendingAction,
      ready,
      setActiveWallet: selectActiveWallet,
      supportedChains: supportedWalletChains,
      switchChain,
      userLabel: userLabel
        ? userLabel.startsWith("0x")
          ? formatAddress(userLabel)
          : userLabel
        : null,
      wallets: walletSummaries,
    }),
    [
      activeAddress,
      activeChain?.name,
      activeChainId,
      authenticated,
      copyAddress,
      errorMessage,
      handleConnectOrCreateWallet,
      handleLinkWallet,
      handleLogin,
      handleLogout,
      isSupportedChain,
      pendingAction,
      ready,
      selectActiveWallet,
      switchChain,
      userLabel,
      walletSummaries,
    ]
  );

  return (
    <WalletAccountContext.Provider value={value}>
      {children}
    </WalletAccountContext.Provider>
  );
}
