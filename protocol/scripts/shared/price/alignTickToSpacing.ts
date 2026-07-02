import type { TickRounding } from "./displayPriceWadToTick.js";

/**
 * Aligns a tick to a tick-spacing multiple, flooring for "down" and ceiling
 * for "up". Uses Math.floor/Math.ceil so negative ticks round away from or
 * toward zero correctly instead of truncating.
 */
export function alignTickToSpacing(
  tick: number,
  tickSpacing: number,
  rounding: TickRounding,
): number {
  if (!Number.isInteger(tick)) {
    throw new Error(`Expected tick to be an integer, received ${tick}.`);
  }
  if (!Number.isInteger(tickSpacing) || tickSpacing <= 0) {
    throw new Error(`Expected tickSpacing to be a positive integer, received ${tickSpacing}.`);
  }

  const quotient =
    rounding === "down" ? Math.floor(tick / tickSpacing) : Math.ceil(tick / tickSpacing);
  const aligned = quotient * tickSpacing;
  // Math.ceil of a small negative quotient yields -0; normalize for logs/JSON.
  return aligned === 0 ? 0 : aligned;
}
