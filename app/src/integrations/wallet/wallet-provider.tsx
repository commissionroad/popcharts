"use client";

import type { ConnectedWallet } from "@privy-io/react-auth";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet, WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useAccount } from "wagmi";

import {
  defaultEvmChain,
  findSupportedEvmChain,
  isSupportedEvmChainId,
  supportedWalletChains,
  type WalletChainSummary,
} from "@/integrations/wallet/chains";
import {
  privyAppId,
  privyClientId,
  privyConfig,
  wagmiConfig,
  walletIntegrationEnabled,
} from "@/integrations/wallet/wallet-config";
import { formatAddress } from "@/lib/format";

type WalletPendingAction =
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
  logout: () => Promise<void>;
  pendingAction: WalletPendingAction | null;
  ready: boolean;
  setActiveWallet: (address: string) => Promise<void>;
  supportedChains: readonly WalletChainSummary[];
  switchChain: (chainId: number) => Promise<void>;
  userLabel: string | null;
  wallets: readonly WalletConnectionSummary[];
};

const noop = () => undefined;
const noopAsync = async () => undefined;

const defaultChainSummary = {
  id: defaultEvmChain.id,
  name: defaultEvmChain.name,
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
  logout: noopAsync,
  pendingAction: null,
  ready: true,
  setActiveWallet: noopAsync,
  supportedChains: supportedWalletChains,
  switchChain: noopAsync,
  userLabel: null,
  wallets: [],
};

const WalletAccountContext = createContext<WalletAccountValue>(disabledWalletValue);

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

  if (!walletIntegrationEnabled || !privyAppId) {
    return (
      <WalletAccountContext.Provider value={disabledWalletValue}>
        {children}
      </WalletAccountContext.Provider>
    );
  }

  const privyClientProps = privyClientId ? { clientId: privyClientId } : {};

  return (
    <PrivyProvider appId={privyAppId} config={privyConfig} {...privyClientProps}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <PrivyWalletAccountProvider>{children}</PrivyWalletAccountProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}

export function useWalletAccount() {
  return useContext(WalletAccountContext);
}

function PrivyWalletAccountProvider({ children }: { children: ReactNode }) {
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

function findWalletByAddress(
  wallets: readonly ConnectedWallet[],
  address: string | null | undefined
) {
  if (!address) {
    return undefined;
  }

  const normalizedAddress = address.toLowerCase();

  return wallets.find((wallet) => wallet.address.toLowerCase() === normalizedAddress);
}

function parseEip155ChainId(chainId: string | undefined) {
  if (!chainId?.startsWith("eip155:")) {
    return null;
  }

  const parsed = Number.parseInt(chainId.replace("eip155:", ""), 10);

  return Number.isFinite(parsed) ? parsed : null;
}

function summarizeWallet(
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

function getWalletErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Wallet action failed. Try again from your wallet.";
}
