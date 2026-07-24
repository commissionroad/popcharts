import { WAD } from "../wad.js";
import { requireDecimals } from "./requireDecimals.js";

/** Pool-specific facts every display-price conversion must carry (ADR 0009). */
export type DisplayPricePoolOrientation = {
  /** Decimal precision of the collateral token. */
  readonly collateralDecimals: number;
  /** Decimal precision of the YES/NO outcome token. */
  readonly outcomeDecimals: number;
  /** Whether the outcome token sorts below collateral as pool currency0. */
  readonly outcomeIsCurrency0: boolean;
};

const Q192 = 1n << 192n;

/**
 * Converts a WAD display price (collateral paid per one outcome token) into
 * the v4 Q64.96 sqrt price for the pool's sorted currencies. Raw v4 price is
 * currency1 raw units per currency0 raw unit, so the display price is scaled
 * by the collateral/outcome decimal difference and inverted when collateral
 * sorts as currency0.
 */
export function displayPriceWadToSqrtPriceX96(
  args: DisplayPricePoolOrientation & { readonly displayPriceWad: bigint },
): bigint {
  if (args.displayPriceWad <= 0n) {
    throw new Error(`Display price must be positive, received ${args.displayPriceWad}.`);
  }
  requireDecimals(args.collateralDecimals, "collateralDecimals");
  requireDecimals(args.outcomeDecimals, "outcomeDecimals");

  // Raw price as an exact rational: display price moves collateral raw units
  // per outcome raw unit, so scale each side by its own token decimals.
  const collateralRawScale = args.displayPriceWad * 10n ** BigInt(args.collateralDecimals);
  const outcomeRawScale = WAD * 10n ** BigInt(args.outcomeDecimals);
  const numerator = args.outcomeIsCurrency0 ? collateralRawScale : outcomeRawScale;
  const denominator = args.outcomeIsCurrency0 ? outcomeRawScale : collateralRawScale;

  return floorSqrt((numerator * Q192) / denominator);
}

// Newton's method floor square root; converges from an initial power-of-two
// overestimate so every iterate stays above the true root until the last step.
function floorSqrt(value: bigint): bigint {
  if (value < 2n) {
    return value;
  }

  let estimate = 1n << (BigInt(value.toString(2).length + 1) / 2n);
  let next = (estimate + value / estimate) / 2n;
  while (next < estimate) {
    estimate = next;
    next = (estimate + value / estimate) / 2n;
  }
  return estimate;
}
