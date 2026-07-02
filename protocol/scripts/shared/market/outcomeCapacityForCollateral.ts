const MAX_SUPPORTED_DECIMALS = 77;

/**
 * Converts a collateral balance into the outcome-token capacity it can back,
 * rounding down like the complete-set market's own decimal scaling. Health
 * and resolution checks compare this capacity against outstanding outcome
 * supply to assert the market's no-shortfall invariant.
 */
export function outcomeCapacityForCollateral(args: {
  readonly collateralAmount: bigint;
  readonly collateralDecimals: number;
  readonly outcomeDecimals: number;
}): bigint {
  requireDecimals(args.collateralDecimals, "collateralDecimals");
  requireDecimals(args.outcomeDecimals, "outcomeDecimals");
  if (args.collateralAmount < 0n) {
    throw new Error(
      `Expected collateralAmount to be non-negative, received ${args.collateralAmount}.`,
    );
  }

  if (args.outcomeDecimals >= args.collateralDecimals) {
    return args.collateralAmount * 10n ** BigInt(args.outcomeDecimals - args.collateralDecimals);
  }
  return args.collateralAmount / 10n ** BigInt(args.collateralDecimals - args.outcomeDecimals);
}

function requireDecimals(decimals: number, label: string): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_SUPPORTED_DECIMALS) {
    throw new Error(`Expected ${label} to be an integer in [0, ${MAX_SUPPORTED_DECIMALS}].`);
  }
}
