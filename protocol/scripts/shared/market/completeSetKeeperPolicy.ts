/**
 * Operational defaults for the keeper and operator scripts (protocol MVP
 * tracker item 4). ADR 0009 keeps the unaudited testnet venue safe through
 * capped sizes and operational monitoring instead of trust in unreviewed
 * code; these constants size that monitoring. Amounts are decimal token
 * strings parsed with the market's collateral decimals, tolerances are
 * decimal WAD price strings, and staleness thresholds are plain block counts.
 * Every value can be overridden with the matching POPCHARTS_* env var
 * documented on each entrypoint.
 */
export const COMPLETE_SET_KEEPER_POLICY = {
  /** Collateral committed to one keeper arbitrage round trip. */
  arbCollateral: "5",
  /** Cap on resolver calls per deferred execution ID in one keeper pass. */
  maxDeferredResolveIterations: 16,
  /** Displayed |YES + NO - 1| drift tolerated before the keeper arbitrages. */
  priceSumTolerance: "0.01",
  /** Blocks a crossed-but-unfilled order may age before inspection flags it. */
  staleCrossedOrderBlocks: 30,
  /** Blocks a pending deferred execution may age before inspection flags it. */
  staleDeferredExecutionBlocks: 30,
} as const;
