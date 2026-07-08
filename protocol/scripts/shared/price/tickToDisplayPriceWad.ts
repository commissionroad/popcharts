import type { DisplayPricePoolOrientation } from "./displayPriceWadToSqrtPriceX96.js";
import { sqrtPriceX96ToDisplayPriceWad } from "./sqrtPriceX96ToDisplayPriceWad.js";
import { tickToSqrtPriceX96 } from "./tickToSqrtPriceX96.js";

/**
 * Converts a pool tick into the WAD display price (collateral paid per one
 * outcome token) at that tick. Inverse of `displayPriceWadToTick`: it chains
 * the exact v4-core TickMath sqrt price through the ADR 0009 display-price
 * rescaling, truncating toward zero like `sqrtPriceX96ToDisplayPriceWad`.
 */
export function tickToDisplayPriceWad(
  args: DisplayPricePoolOrientation & { readonly tick: number },
): bigint {
  return sqrtPriceX96ToDisplayPriceWad({
    collateralDecimals: args.collateralDecimals,
    outcomeDecimals: args.outcomeDecimals,
    outcomeIsCurrency0: args.outcomeIsCurrency0,
    sqrtPriceX96: tickToSqrtPriceX96(args.tick),
  });
}
