import {
  displayPriceWadToSqrtPriceX96,
  type DisplayPricePoolOrientation,
} from "./displayPriceWadToSqrtPriceX96.js";
import { sqrtPriceX96ToTick } from "./sqrtPriceX96ToTick.js";
import { tickToSqrtPriceX96 } from "./tickToSqrtPriceX96.js";

/** Direction a fractional tick is pushed toward an integer or spacing multiple. */
export type TickRounding = "down" | "up";

/**
 * Converts a WAD display price into a pool tick. "down" returns the greatest
 * tick whose price is at or below the target; "up" returns the least tick at
 * or above it. Bound derivation uses the direction that widens — never
 * narrows — a display-price range (ADR 0009).
 */
export function displayPriceWadToTick(
  args: DisplayPricePoolOrientation & {
    readonly displayPriceWad: bigint;
    readonly rounding: TickRounding;
  },
): number {
  const sqrtPriceX96 = displayPriceWadToSqrtPriceX96(args);
  const floorTick = sqrtPriceX96ToTick(sqrtPriceX96);
  if (args.rounding === "down" || tickToSqrtPriceX96(floorTick) === sqrtPriceX96) {
    return floorTick;
  }
  return floorTick + 1;
}
