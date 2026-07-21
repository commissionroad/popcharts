/**
 * MarketTypes.MarketStatus enum names by on-chain ordinal (keep in order-sync
 * with contracts/types/MarketTypes.sol), so operator scripts print named
 * pregrad statuses instead of magic numbers.
 */
export const PREGRAD_MARKET_STATUS_NAMES = [
  "Active",
  "Frozen",
  "Graduating",
  "Graduated",
  "Refunded",
  "Resolved",
  "Cancelled",
  "UnderReview",
  "Rejected",
] as const;
