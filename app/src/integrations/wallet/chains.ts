import type { Chain as PrivyChain } from "@privy-io/chains";
import {
  arbitrum as privyArbitrum,
  base as privyBase,
  baseSepolia as privyBaseSepolia,
  mainnet as privyMainnet,
  optimism as privyOptimism,
  polygon as privyPolygon,
} from "@privy-io/chains";
import type { Chain } from "viem";
import {
  arbitrum,
  base,
  baseSepolia,
  mainnet,
  optimism,
  polygon,
} from "viem/chains";

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

export const defaultEvmChain = base;
export const defaultPrivyChain = privyBase;

export const supportedWagmiChains: readonly [Chain, ...Chain[]] =
  process.env.NEXT_PUBLIC_POPCHARTS_ENABLE_TESTNETS === "true"
    ? testnetWagmiChains
    : productionWagmiChains;

export const supportedPrivyChains: readonly [PrivyChain, ...PrivyChain[]] =
  process.env.NEXT_PUBLIC_POPCHARTS_ENABLE_TESTNETS === "true"
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

export function findSupportedEvmChain(chainId: number | null | undefined) {
  if (!chainId) {
    return undefined;
  }

  return supportedWagmiChains.find((chain) => chain.id === chainId);
}

export function isSupportedEvmChainId(chainId: number | null | undefined) {
  return Boolean(findSupportedEvmChain(chainId));
}
