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

/**
 * Human-readable market side labels used by off-chain domains, in contract
 * encoding order (YES first). This is the single definition of the label set:
 * off-chain validation schemas and Postgres enums derive from it rather than
 * restating the two literals.
 */
export const MARKET_SIDES = ["yes", "no"] as const;

/** One of {@link MARKET_SIDES}. */
export type MarketSide = (typeof MARKET_SIDES)[number];

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
