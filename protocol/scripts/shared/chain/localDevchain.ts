import { LOCAL_DEVCHAIN_CHAIN_ID } from "../../../src/chain/localDevchain.js";

/**
 * Shared local devchain metadata for deployment scripts targeting `pnpm devchain:node`.
 */
export const LOCAL_DEVCHAIN = {
  chainEnv: "local",
  chainId: LOCAL_DEVCHAIN_CHAIN_ID,
  name: "Local Devchain",
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH",
  },
  rpcUrl: "http://127.0.0.1:8545",
} as const;
