/**
 * MarketTypes.MarketStatus numeric encoding shared by every Pop Charts
 * contract (contracts/types/MarketTypes.sol). Solidity enums have no ABI
 * representation, so off-chain code cannot derive these codes from the
 * generated metadata; this table is the single TS definition — import it,
 * never restate it.
 */
export const MARKET_STATUS = {
  active: 0,
  frozen: 1,
  graduating: 2,
  graduated: 3,
  refunded: 4,
  resolved: 5,
  cancelled: 6,
  underReview: 7,
  rejected: 8,
} as const;

/** A MarketTypes.MarketStatus contract encoding. */
export type MarketStatusCode = (typeof MARKET_STATUS)[keyof typeof MARKET_STATUS];
