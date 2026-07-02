/**
 * Numeric values of the CompleteSetBinaryMarket.Status enum, so smoke and
 * operator scripts compare on-chain status reads against named states instead
 * of magic numbers.
 */
export const COMPLETE_SET_MARKET_STATUS = {
  cancelled: 2,
  resolved: 1,
  trading: 0,
} as const;
