/**
 * CompleteSetBinaryMarket.Status numeric encoding
 * (contracts/postgrad/CompleteSetBinaryMarket.sol). Solidity enums have no ABI
 * representation, so off-chain code cannot derive these codes from the
 * generated metadata; this table is the single TS definition — import it,
 * never restate it.
 *
 * The enum is append-only, so the codes are NOT in lifecycle order:
 * `resolutionPending` and `disputed` arrived with the dispute window (protocol
 * ADR 0013) and were appended so the three original ordinals stayed stable. A
 * market runs trading → resolutionPending → (disputed) → resolved.
 *
 * Distinct from `MARKET_STATUS`, which encodes the pregrad
 * MarketTypes.MarketStatus set.
 */
export const POSTGRAD_MARKET_STATUS = {
  trading: 0,
  resolved: 1,
  cancelled: 2,
  resolutionPending: 3,
  disputed: 4,
} as const;

/** A CompleteSetBinaryMarket.Status contract encoding. */
export type PostgradMarketStatusCode =
  (typeof POSTGRAD_MARKET_STATUS)[keyof typeof POSTGRAD_MARKET_STATUS];
