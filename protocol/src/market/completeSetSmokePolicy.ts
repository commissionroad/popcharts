/**
 * Default sizing policy for the complete-set smoke flows. Amounts are decimal
 * token strings parsed with the manifest's collateral decimals so the same
 * defaults work for the 18-decimal local mock and 6-decimal Arc USDC. Tick
 * distances are expressed in ADR 0009 tick-spacing multiples (spacing 60).
 * Every value can be overridden with the matching POPCHARTS_SMOKE_* env var
 * documented on each smoke entrypoint.
 */
export const COMPLETE_SET_SMOKE_POLICY = {
  /** Collateral minted into complete sets for one arb round trip. */
  arbCollateral: "5",
  /** Spacings past the maker order's far tick the taker swap may travel. */
  crossMarginSpacings: 2,
  /** Collateral budget per pool side for dev backstop liquidity. */
  devLiquidityCollateral: "100",
  /** Half-width of the dev backstop liquidity range, in spacings. */
  devLiquidityRangeSpacings: 25,
  /** Collateral minted into complete sets to fund the maker order. */
  makerCollateral: "25",
  /** Spacings between the current pool tick and the maker order range. */
  orderOffsetSpacings: 1,
  /** Width of the maker order range, in spacings. */
  orderWidthSpacings: 1,
  /** WAD price-sum band treated as balanced by the arb flow. */
  priceSumToleranceWad: 0n,
  /** Collateral the taker spends to cross the maker order. */
  takerCollateral: "20",
} as const;
