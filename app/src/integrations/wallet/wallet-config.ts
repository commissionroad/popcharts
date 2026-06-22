import type { PrivyClientConfig } from "@privy-io/react-auth";
import { createConfig as createPrivyWagmiConfig } from "@privy-io/wagmi";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

import {
  defaultPrivyChain,
  getWalletRpcUrlForChain,
  supportedPrivyChains,
  supportedWagmiChains,
} from "@/integrations/wallet/chains";

const popChartsTheme = {
  accent: "#ff2e97",
  background: "#08080a",
} as const;

const walletConnectCloudProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
export const privyClientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;
export const localWalletIntegrationEnabled =
  process.env.NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_WALLET === "true" ||
  (!privyAppId && process.env.NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN === "true");
export const walletIntegrationEnabled =
  Boolean(privyAppId) || localWalletIntegrationEnabled;

const wagmiTransports = Object.fromEntries(
  supportedWagmiChains.map((chain) => [
    chain.id,
    http(getWalletRpcUrlForChain(chain.id)),
  ])
);

export const privyWagmiConfig = createPrivyWagmiConfig({
  chains: supportedWagmiChains,
  ssr: true,
  transports: wagmiTransports,
});

export const localWalletWagmiConfig = createConfig({
  chains: supportedWagmiChains,
  connectors: [injected()],
  ssr: true,
  transports: wagmiTransports,
});

export const privyConfig = {
  appearance: {
    accentColor: popChartsTheme.accent,
    landingHeader: "Enter Pop Charts",
    loginMessage: "Sign in with email, Google, or a wallet to place receipts.",
    showWalletLoginFirst: false,
    theme: popChartsTheme.background,
    walletChainType: "ethereum-only",
    walletList: [
      "detected_ethereum_wallets",
      "metamask",
      "coinbase_wallet",
      "wallet_connect",
      "rainbow",
      "uniswap",
    ],
  },
  defaultChain: defaultPrivyChain,
  embeddedWallets: {
    ethereum: {
      createOnLogin: "users-without-wallets",
    },
  },
  loginMethods: ["email", "google", "wallet"],
  supportedChains: [...supportedPrivyChains],
  ...(walletConnectCloudProjectId ? { walletConnectCloudProjectId } : {}),
} satisfies PrivyClientConfig;
