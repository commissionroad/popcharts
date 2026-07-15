/**
 * MarketTypes.Side numeric encoding shared by every Pop Charts contract:
 * YES is 0 and NO is 1. Off-chain code converts between this encoding and the
 * human-readable "yes"/"no" labels through these helpers so the mapping is
 * written down exactly once.
 */

/** MarketTypes.Side.Yes contract encoding. */
export const SIDE_YES = 0;
/** MarketTypes.Side.No contract encoding. */
export const SIDE_NO = 1;

/** Human-readable market side label used by off-chain domains. */
export type MarketSide = "yes" | "no";

/**
 * Decodes a MarketTypes.Side value from a contract event or read. The
 * on-chain enum has exactly two members, so any non-YES value is NO.
 */
export function contractSideToMarketSide(side: number | bigint): MarketSide {
  return Number(side) === SIDE_YES ? "yes" : "no";
}

/** Encodes a market side as a MarketTypes.Side contract argument. */
export function marketSideToContractSide(side: MarketSide): typeof SIDE_YES | typeof SIDE_NO {
  return side === "yes" ? SIDE_YES : SIDE_NO;
}
