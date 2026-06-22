import type { Chain as PrivyChain } from "@privy-io/chains";
import { type Chain, defineChain } from "viem";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_EXPLORER_URL,
  ARC_TESTNET_NAME,
  ARC_TESTNET_NATIVE_CURRENCY,
  ARC_TESTNET_RPC_URL,
  ARC_TESTNET_RPC_WS_URL,
} from "@/integrations/contracts/arc-testnet";
import {
  configuredPopChartsChainId,
  configuredPopChartsRpcUrl,
  localChainEnabled,
} from "@/integrations/contracts/config";

const localChainId = configuredPopChartsChainId ?? 31337;
const localRpcUrl = configuredPopChartsRpcUrl ?? "http://127.0.0.1:8545";
const localHardhatChain = defineChain({
  id: localChainId,
  name: localChainId === 31337 ? "Hardhat Local" : `Local Devchain ${localChainId}`,
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: [localRpcUrl],
    },
  },
});
const localHardhatPrivyChain = localHardhatChain as PrivyChain;

export const arcTestnet = defineChain({
  id: ARC_TESTNET_CHAIN_ID,
  name: ARC_TESTNET_NAME,
  nativeCurrency: ARC_TESTNET_NATIVE_CURRENCY,
  rpcUrls: {
    default: {
      http: [ARC_TESTNET_RPC_URL],
      webSocket: [ARC_TESTNET_RPC_WS_URL],
    },
    public: {
      http: [ARC_TESTNET_RPC_URL],
      webSocket: [ARC_TESTNET_RPC_WS_URL],
    },
  },
  blockExplorers: {
    default: {
      name: "ArcScan",
      url: ARC_TESTNET_EXPLORER_URL,
    },
  },
  testnet: true,
});
const arcTestnetPrivyChain = arcTestnet as PrivyChain;

export const defaultEvmChain = localChainEnabled ? localHardhatChain : arcTestnet;
export const defaultPrivyChain = localChainEnabled
  ? localHardhatPrivyChain
  : arcTestnetPrivyChain;

export const supportedWagmiChains: readonly [Chain, ...Chain[]] = localChainEnabled
  ? [localHardhatChain, arcTestnet]
  : [arcTestnet];

export const supportedPrivyChains: readonly [PrivyChain, ...PrivyChain[]] =
  localChainEnabled
    ? [localHardhatPrivyChain, arcTestnetPrivyChain]
    : [arcTestnetPrivyChain];

export type WalletChainSummary = {
  id: number;
  name: string;
};

export const supportedWalletChains: readonly WalletChainSummary[] =
  supportedWagmiChains.map((chain) => ({
    id: chain.id,
    name: chain.name,
  }));

export function getWalletRpcUrlForChain(chainId: number) {
  return chainId === configuredPopChartsChainId
    ? (configuredPopChartsRpcUrl ?? undefined)
    : undefined;
}

export function findSupportedEvmChain(chainId: number | null | undefined) {
  if (!chainId) {
    return undefined;
  }

  return supportedWagmiChains.find((chain) => chain.id === chainId);
}

export function isSupportedEvmChainId(chainId: number | null | undefined) {
  return Boolean(findSupportedEvmChain(chainId));
}
