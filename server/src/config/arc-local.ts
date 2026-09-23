import { defineChain } from "viem";

/**
 * The single-node Arc chain a developer runs on their own machine (ADR 0028).
 *
 * Deliberately shaped like `arc-testnet.ts`: the point of running a real Arc
 * node locally is that local and testnet describe the same kind of chain, so
 * the two definitions differ only where the chains genuinely differ — id, RPC
 * endpoint, and the fact that this one is disposable. The metadata here
 * mirrors `protocol/scripts/shared/chain/arcLocal.ts`, which is the same
 * chain described for the Hardhat-side deploy scripts.
 */

/**
 * Arc's single-node local chain reports 1337, **not** Hardhat's 31337
 * (ADR 0028 G6). The two ids differ by one digit and nothing else, which is
 * exactly why every site that used to hardcode 31337 has to be found and
 * changed rather than assumed compatible.
 */
export const ARC_LOCAL_CHAIN_ID = 1337;
/** Display name for the Arc local chain, in wallets and chain pickers. */
export const ARC_LOCAL_NAME = "Arc Local";
/** Default HTTP RPC endpoint; overridable via LOCAL_RPC_HTTP_URL. */
export const ARC_LOCAL_RPC_HTTP_URL = "http://127.0.0.1:8545";
/** Default websocket RPC endpoint; overridable via LOCAL_RPC_WSS_URL. */
export const ARC_LOCAL_RPC_WSS_URL = "ws://127.0.0.1:8545";
/**
 * Arc charges gas in USDC, locally as on testnet. This is precisely the
 * property the Hardhat devchain could not model — it billed gas in ETH — and
 * it is why the local chain object cannot simply be viem's `hardhat` with a
 * different id.
 */
export const ARC_LOCAL_NATIVE_CURRENCY = {
  decimals: 18,
  name: "USDC",
  symbol: "USDC",
} as const;

/**
 * The Arc local viem chain definition. No block explorer: there is none for a
 * chain that lives in an ignored datadir. `testnet: true` keeps viem and any
 * wallet UI from treating it as a production network.
 */
export const arcLocal = defineChain({
  id: ARC_LOCAL_CHAIN_ID,
  name: ARC_LOCAL_NAME,
  nativeCurrency: ARC_LOCAL_NATIVE_CURRENCY,
  rpcUrls: {
    default: {
      http: [ARC_LOCAL_RPC_HTTP_URL],
      webSocket: [ARC_LOCAL_RPC_WSS_URL],
    },
  },
  testnet: true,
});
