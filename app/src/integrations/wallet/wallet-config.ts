import type { PrivyClientConfig } from "@privy-io/react-auth";
import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";

import {
  defaultPrivyChain,
  supportedPrivyChains,
  supportedWagmiChains,
} from "@/integrations/wallet/chains";

const popChartsTheme = {
  accent: "#ff2e97",
  background: "#08080a",
} as const;

const walletConnectCloudProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
export const privyClientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;
export const walletIntegrationEnabled = Boolean(privyAppId);

export const wagmiConfig = createConfig({
  chains: supportedWagmiChains,
  ssr: true,
  transports: Object.fromEntries(
    supportedWagmiChains.map((chain) => [chain.id, http()])
  ),
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
      "base_account",
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
  ...(walletConnectCloudProjectId
    ? { walletConnectCloudProjectId }
    : {}),
} satisfies PrivyClientConfig;
