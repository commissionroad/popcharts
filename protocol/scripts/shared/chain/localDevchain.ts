/**
 * Shared local devchain metadata for deployment scripts targeting `pnpm devchain:node`.
 */
export const LOCAL_DEVCHAIN = {
  chainEnv: "local",
  chainId: 31_337,
  name: "Local Devchain",
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH",
  },
  rpcUrl: "http://127.0.0.1:8545",
} as const;
