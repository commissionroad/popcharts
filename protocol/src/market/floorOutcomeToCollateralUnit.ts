const MAX_SUPPORTED_DECIMALS = 77;

/**
 * Floors an outcome-token amount to the largest amount that converts into
 * collateral raw units without dust, mirroring the complete-set market's
 * `AmountHasDust` guard. Swap outputs carry arbitrary raw amounts, so merge
 * and redeem flows must round down before calling the market.
 */
export function floorOutcomeToCollateralUnit(args: {
  readonly collateralDecimals: number;
  readonly outcomeAmount: bigint;
  readonly outcomeDecimals: number;
}): bigint {
  requireDecimals(args.collateralDecimals, "collateralDecimals");
  requireDecimals(args.outcomeDecimals, "outcomeDecimals");
  if (args.outcomeAmount < 0n) {
    throw new Error(`Expected outcomeAmount to be non-negative, received ${args.outcomeAmount}.`);
  }

  if (args.outcomeDecimals <= args.collateralDecimals) {
    return args.outcomeAmount;
  }
  const factor = 10n ** BigInt(args.outcomeDecimals - args.collateralDecimals);
  return args.outcomeAmount - (args.outcomeAmount % factor);
}

function requireDecimals(decimals: number, label: string): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_SUPPORTED_DECIMALS) {
    throw new Error(`Expected ${label} to be an integer in [0, ${MAX_SUPPORTED_DECIMALS}].`);
  }
}
