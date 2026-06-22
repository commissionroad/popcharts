import type { Chain as PrivyChain } from "@privy-io/chains";
import {
  arbitrum as privyArbitrum,
  base as privyBase,
  baseSepolia as privyBaseSepolia,
  mainnet as privyMainnet,
  optimism as privyOptimism,
  polygon as privyPolygon,
} from "@privy-io/chains";
import { type Chain, defineChain } from "viem";
import { arbitrum, base, baseSepolia, mainnet, optimism, polygon } from "viem/chains";

import {
  ARC_NATIVE_CURRENCY,
  configuredPopChartsChainId,
  configuredPopChartsRpcUrl,
  LOCAL_NATIVE_CURRENCY,
  popChartsChainEnv,
} from "@/integrations/contracts/config";

const configuredChainId = configuredPopChartsChainId ?? 31337;
const configuredRpcUrl = configuredPopChartsRpcUrl ?? "http://127.0.0.1:8545";
const configuredNativeCurrency =
  popChartsChainEnv === "local" || popChartsChainEnv === "mock"
    ? LOCAL_NATIVE_CURRENCY
    : ARC_NATIVE_CURRENCY;
const configuredPopChartsChain = defineChain({
  id: configuredChainId,
  name:
    popChartsChainEnv === "arc-testnet"
      ? "Arc Testnet"
      : configuredChainId === 31337
        ? "Hardhat Local"
        : `Local Devchain ${configuredChainId}`,
  nativeCurrency: configuredNativeCurrency,
  rpcUrls: {
    default: {
      http: [configuredRpcUrl],
    },
  },
});
const configuredPopChartsPrivyChain = configuredPopChartsChain as PrivyChain;
const configuredChainEnabled =
  popChartsChainEnv === "arc-testnet" ||
  process.env.NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN === "true";

const productionWagmiChains = [base, mainnet, arbitrum, optimism, polygon] as const;
const testnetWagmiChains = [
  base,
  baseSepolia,
  mainnet,
  arbitrum,
  optimism,
  polygon,
] as const;
const productionPrivyChains = [
  privyBase,
  privyMainnet,
  privyArbitrum,
  privyOptimism,
  privyPolygon,
] as const;
const testnetPrivyChains = [
  privyBase,
  privyBaseSepolia,
  privyMainnet,
  privyArbitrum,
  privyOptimism,
  privyPolygon,
] as const;

export const defaultEvmChain = configuredChainEnabled ? configuredPopChartsChain : base;
export const defaultPrivyChain = configuredChainEnabled
  ? configuredPopChartsPrivyChain
  : privyBase;

export const supportedWagmiChains: readonly [Chain, ...Chain[]] = configuredChainEnabled
  ? [configuredPopChartsChain, ...testnetWagmiChains]
  : process.env.NEXT_PUBLIC_POPCHARTS_ENABLE_TESTNETS === "true"
    ? testnetWagmiChains
    : productionWagmiChains;

export const supportedPrivyChains: readonly [PrivyChain, ...PrivyChain[]] =
  configuredChainEnabled
    ? [configuredPopChartsPrivyChain, ...testnetPrivyChains]
    : process.env.NEXT_PUBLIC_POPCHARTS_ENABLE_TESTNETS === "true"
      ? testnetPrivyChains
      : productionPrivyChains;

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
