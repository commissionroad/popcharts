import { defineChain } from "viem";

/** Arc Testnet chain id, per the published Arc network parameters. */
export const ARC_TESTNET_CHAIN_ID = 5_042_002;
/** Display name for the Arc Testnet chain. */
export const ARC_TESTNET_NAME = "Arc Testnet";
/** Default public HTTP RPC endpoint; overridable via ARC_TESTNET_RPC_HTTP_URL. */
export const ARC_TESTNET_RPC_HTTP_URL = "https://rpc.testnet.arc.network";
/** Default public websocket RPC endpoint; overridable via ARC_TESTNET_RPC_WSS_URL. */
export const ARC_TESTNET_RPC_WSS_URL = "wss://rpc.testnet.arc.network";
/** ArcScan block explorer base URL for the testnet. */
export const ARC_TESTNET_EXPLORER_URL = "https://testnet.arcscan.app";
/** Arc Testnet uses USDC (18 decimals) as its native gas currency. */
export const ARC_TESTNET_NATIVE_CURRENCY = {
  decimals: 18,
  name: "USDC",
  symbol: "USDC",
} as const;

/**
 * The Arc Testnet viem chain definition, assembled from the constants above —
 * the single chain object every viem client in the server uses for this
 * network.
 */
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
