/**
 * The single-node Arc chain a developer runs on their own machine (ADR 0028),
 * described the same way `arc-testnet.ts` describes the shared testnet.
 *
 * Mirrors `protocol/scripts/shared/chain/arcLocal.ts` and
 * `server/src/config/arc-local.ts`. The three copies exist because the app
 * bundle, the Bun server, and the Hardhat deploy scripts cannot share a module
 * today — `@popcharts/protocol` exports no chain-metadata subpath — which is
 * already true of Arc Testnet's constants.
 */

/**
 * Arc's local chain reports 1337, **not** Hardhat's 31337 (ADR 0028 G6).
 * Nothing may infer "is this local?" from anything but the chain id: arc-node
 * reports `web3_clientVersion` as a plain `reth/...` string with no Arc marker
 * (G15), so the id is the only signal that distinguishes these chains.
 */
export const ARC_LOCAL_CHAIN_ID = 1337;
/** Display name shown in the wallet chain picker. */
export const ARC_LOCAL_NAME = "Arc Local";
/**
 * Arc charges gas in USDC locally exactly as it does on testnet — the property
 * the Hardhat devchain could not model, since it billed gas in ETH.
 */
export const ARC_LOCAL_NATIVE_CURRENCY = {
  decimals: 18,
  name: "USDC",
  symbol: "USDC",
} as const;
