import { COMPLETE_SET_PRICE_POLICY } from "./completeSetPricePolicy.js";

/**
 * Clamps a WAD display price into the ADR 0009 [0.001, 0.999] epsilon band so
 * out-of-range targets configure as at-bound prices, never as 0 or 1.
 */
export function clampDisplayPriceWad(displayPriceWad: bigint): bigint {
  if (displayPriceWad < COMPLETE_SET_PRICE_POLICY.minDisplayPriceWad) {
    return COMPLETE_SET_PRICE_POLICY.minDisplayPriceWad;
  }
  if (displayPriceWad > COMPLETE_SET_PRICE_POLICY.maxDisplayPriceWad) {
    return COMPLETE_SET_PRICE_POLICY.maxDisplayPriceWad;
  }
  return displayPriceWad;
}
