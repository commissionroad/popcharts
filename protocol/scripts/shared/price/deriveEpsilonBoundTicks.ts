import { alignTickToSpacing } from "./alignTickToSpacing.js";
import { COMPLETE_SET_PRICE_POLICY } from "./completeSetPricePolicy.js";
import type { DisplayPricePoolOrientation } from "./displayPriceWadToSqrtPriceX96.js";
import { displayPriceWadToTick } from "./displayPriceWadToTick.js";

/** Inclusive pool tick bounds derived from the display-price epsilon band. */
export type EpsilonBoundTicks = {
  readonly lowerTick: number;
  readonly upperTick: number;
};

/**
 * Derives the inclusive pool tick bounds for the ADR 0009 display-price band
 * [0.001, 0.999]. Display price inverts when collateral sorts as currency0,
 * so each epsilon price is rounded outward for the bound it lands on, then
 * the lower bound floors and the upper bound ceils to tick-spacing multiples.
 * The configured range can only be wider than the epsilon range, never
 * narrower.
 */
export function deriveEpsilonBoundTicks(
  orientation: DisplayPricePoolOrientation,
): EpsilonBoundTicks {
  const minPriceTick = displayPriceWadToTick({
    ...orientation,
    displayPriceWad: COMPLETE_SET_PRICE_POLICY.minDisplayPriceWad,
    rounding: orientation.outcomeIsCurrency0 ? "down" : "up",
  });
  const maxPriceTick = displayPriceWadToTick({
    ...orientation,
    displayPriceWad: COMPLETE_SET_PRICE_POLICY.maxDisplayPriceWad,
    rounding: orientation.outcomeIsCurrency0 ? "up" : "down",
  });

  return {
    lowerTick: alignTickToSpacing(
      Math.min(minPriceTick, maxPriceTick),
      COMPLETE_SET_PRICE_POLICY.tickSpacing,
      "down",
    ),
    upperTick: alignTickToSpacing(
      Math.max(minPriceTick, maxPriceTick),
      COMPLETE_SET_PRICE_POLICY.tickSpacing,
      "up",
    ),
  };
}
