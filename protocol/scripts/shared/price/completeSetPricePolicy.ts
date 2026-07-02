/**
 * Complete-set testnet price and tick policy recorded by ADR 0009
 * (docs/adr/0009-complete-set-testnet-policy.md). Displayed prices mean
 * collateral paid per one outcome token, WAD-scaled here so scripts never
 * carry floating-point prices: display prices clamp to [0.001, 0.999],
 * outcome tokens use 18 decimals, and bounded pools run with fee 3000 and
 * tick spacing 60. Changing any value requires a superseding ADR plus
 * regenerated golden tests for both currency sort orders.
 */
export const COMPLETE_SET_PRICE_POLICY = {
  maxDisplayPriceWad: 999_000_000_000_000_000n,
  minDisplayPriceWad: 1_000_000_000_000_000n,
  outcomeDecimals: 18,
  poolFee: 3000,
  tickSpacing: 60,
} as const;
