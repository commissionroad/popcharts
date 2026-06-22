import { defineChain } from "viem";

export const ARC_TESTNET_CHAIN_ID = 5_042_002;
export const ARC_TESTNET_NAME = "Arc Testnet";
export const ARC_TESTNET_RPC_HTTP_URL = "https://rpc.testnet.arc.network";
export const ARC_TESTNET_RPC_WSS_URL = "wss://rpc.testnet.arc.network";
export const ARC_TESTNET_EXPLORER_URL = "https://testnet.arcscan.app";
export const ARC_TESTNET_NATIVE_CURRENCY = {
  decimals: 18,
  name: "USDC",
  symbol: "USDC",
} as const;

export const arcTestnet = defineChain({
  id: ARC_TESTNET_CHAIN_ID,
  name: ARC_TESTNET_NAME,
  nativeCurrency: ARC_TESTNET_NATIVE_CURRENCY,
  rpcUrls: {
    default: {
      http: [ARC_TESTNET_RPC_HTTP_URL],
      webSocket: [ARC_TESTNET_RPC_WSS_URL],
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
