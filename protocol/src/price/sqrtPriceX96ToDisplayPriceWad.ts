import type { DisplayPricePoolOrientation } from "./displayPriceWadToSqrtPriceX96.js";
import { requireDecimals } from "./requireDecimals.js";

const WAD = 10n ** 18n;
const Q192 = 1n << 192n;

/**
 * Converts a pool's v4 Q64.96 sqrt price back into the WAD display price
 * (collateral paid per one outcome token). Inverse of
 * `displayPriceWadToSqrtPriceX96`: raw v4 price is currency1 raw units per
 * currency0 raw unit, so the raw price is rescaled by the token decimals and
 * inverted when collateral sorts as currency0. Truncates toward zero, which
 * is fine for the display and arb-direction reads the smoke flows perform.
 */
export function sqrtPriceX96ToDisplayPriceWad(
  args: DisplayPricePoolOrientation & { readonly sqrtPriceX96: bigint },
): bigint {
  if (args.sqrtPriceX96 <= 0n) {
    throw new Error(`Expected sqrtPriceX96 to be positive, received ${args.sqrtPriceX96}.`);
  }
  requireDecimals(args.collateralDecimals, "collateralDecimals");
  requireDecimals(args.outcomeDecimals, "outcomeDecimals");

  const priceX192 = args.sqrtPriceX96 * args.sqrtPriceX96;
  const collateralScale = 10n ** BigInt(args.collateralDecimals);
  const outcomeScale = 10n ** BigInt(args.outcomeDecimals);
  if (args.outcomeIsCurrency0) {
    return (priceX192 * WAD * outcomeScale) / (Q192 * collateralScale);
  }
  return (Q192 * WAD * outcomeScale) / (priceX192 * collateralScale);
}
