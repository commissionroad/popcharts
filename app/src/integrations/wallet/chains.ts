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
  getLocalChainProfile,
  localChainEnabled,
} from "@/integrations/contracts/config";

const localChainId = configuredPopChartsChainId;
const localRpcUrl = configuredPopChartsRpcUrl;
// Name and gas currency come from the chain id, because the two local chains
// disagree on both: Hardhat's devchain is "Hardhat Local" charging ETH, Arc's
// single-node chain is "Arc Local" charging USDC (ADR 0028 G6). The id is also
// the only thing that can tell them apart — arc-node's `web3_clientVersion` is
// an unmarked `reth/...` string (G15). An id neither profile claims still gets
// the old generic "Local Devchain <id>" naming.
const localChainProfile = getLocalChainProfile(localChainId);
const localDevChain = defineChain({
  id: localChainId,
  name: localChainProfile.name,
  nativeCurrency: localChainProfile.nativeCurrency,
  rpcUrls: {
    default: {
      http: [localRpcUrl],
    },
  },
});
const localDevPrivyChain = localDevChain as PrivyChain;

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

export const defaultEvmChain = localChainEnabled ? localDevChain : arcTestnet;
export const defaultPrivyChain = localChainEnabled
  ? localDevPrivyChain
  : arcTestnetPrivyChain;

export const supportedWagmiChains: readonly [Chain, ...Chain[]] = localChainEnabled
  ? [localDevChain, arcTestnet]
  : [arcTestnet];

export const supportedPrivyChains: readonly [PrivyChain, ...PrivyChain[]] =
  localChainEnabled
    ? [localDevPrivyChain, arcTestnetPrivyChain]
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
  return chainId === configuredPopChartsChainId ? configuredPopChartsRpcUrl : undefined;
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
