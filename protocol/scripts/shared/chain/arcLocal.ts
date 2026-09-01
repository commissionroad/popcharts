/**
 * Shared Arc local devchain metadata for deployment scripts and Hardhat
 * config — the single-node `arc-localdev` chain started by
 * `scripts/arc-node.ts` at the repository root.
 *
 * Deliberately shaped like `arcTestnet.ts`: the point of running a real Arc
 * node locally is that local and testnet describe the same kind of chain,
 * so the two metadata objects should differ only where the chains genuinely
 * differ (id, RPC URL, and the fact that this one is disposable).
 *
 * The native currency is USDC here as on testnet — Arc charges gas in USDC,
 * which is precisely the property a Hardhat devchain could not model. See
 * ADR 0028.
 */
export const ARC_LOCAL = {
  chainEnv: "arc-local",
  chainId: 1337,
  name: "Arc Local",
  nativeCurrency: {
    decimals: 18,
    name: "USDC",
    symbol: "USDC",
  },
  rpcUrl: "http://127.0.0.1:8545",
  rpcWsUrl: "ws://127.0.0.1:8545",
} as const;
