import { COMPLETE_SET_PRICE_POLICY } from "@popcharts/protocol/complete-set-price-policy";
import {
  MAX_TICK,
  MIN_TICK,
  tickToSqrtPriceX96,
} from "@popcharts/protocol/tick-to-sqrt-price";

import { WAD } from "@/domain/tokens/wad";

import type { VenueOrderDirection } from "./limit-order";

const Q192 = 1n << 192n;

/**
 * Tick math for venue maker orders, mirroring the protocol's
 * displayPriceWadToTick/alignTickToSpacing pair for the ADR 0009 fixed
 * 18/18-decimal pools. The protocol package's root export chains `.js`
 * relative specifiers that Next's bundler cannot resolve (see the
 * postgrad-venue integration notes), so the mapping is reproduced here on top
 * of the self-contained `tick-to-sqrt-price` subpath and locked to the
 * protocol implementation by parity tests.
 */

/** Direction a fractional tick is pushed toward an integer. */
export type TickRounding = "down" | "up";

/**
 * The exact priceX192 rational the protocol's display-price conversion
 * targets: raw currency1-per-currency0 price in Q64.192, truncated the same
 * way displayPriceWadToSqrtPriceX96 truncates before its integer sqrt.
 */
function displayPriceWadToPriceX192({
  displayPriceWad,
  outcomeIsCurrency0,
}: {
  displayPriceWad: bigint;
  outcomeIsCurrency0: boolean;
}): bigint {
  if (displayPriceWad <= 0n) {
    throw new Error(`Display price must be positive, received ${displayPriceWad}.`);
  }

  return outcomeIsCurrency0
    ? (displayPriceWad * Q192) / WAD
    : (WAD * Q192) / displayPriceWad;
}

/**
 * Converts a WAD display price (collateral per outcome token) into a pool
 * tick with the protocol's semantics: "down" returns the greatest tick whose
 * sqrt price is at or below the price's sqrt target, "up" the least tick at
 * or above it. Comparisons run in squared (priceX192) space so no integer
 * square root is needed: for integer a and X, a <= floor(sqrt(X)) iff
 * a*a <= X.
 */
export function displayPriceWadToTick({
  displayPriceWad,
  outcomeIsCurrency0,
  rounding,
}: {
  displayPriceWad: bigint;
  outcomeIsCurrency0: boolean;
  rounding: TickRounding;
}): number {
  const priceX192 = displayPriceWadToPriceX192({
    displayPriceWad,
    outcomeIsCurrency0,
  });

  // Greatest tick whose sqrt price is <= floor(sqrt(priceX192)).
  let low = MIN_TICK;
  let high = MAX_TICK;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const sqrtPrice = tickToSqrtPriceX96(mid);

    if (sqrtPrice * sqrtPrice <= priceX192) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  const floorSqrtPrice = tickToSqrtPriceX96(low);
  const exact =
    floorSqrtPrice * floorSqrtPrice <= priceX192 &&
    (floorSqrtPrice + 1n) * (floorSqrtPrice + 1n) > priceX192;

  if (rounding === "down" || exact) {
    return low;
  }

  return low + 1;
}

/**
 * Aligns a tick to a tick-spacing multiple, flooring for "down" and ceiling
 * for "up" (mirrors the protocol's alignTickToSpacing for positive spacings).
 */
export function alignTickToSpacing(
  tick: number,
  tickSpacing: number,
  rounding: TickRounding
): number {
  const quotient =
    rounding === "down"
      ? Math.floor(tick / tickSpacing)
      : Math.ceil(tick / tickSpacing);
  const aligned = quotient * tickSpacing;

  // Math.ceil of a small negative quotient yields -0; normalize it.
  return aligned === 0 ? 0 : aligned;
}

/**
 * A resting maker order's placement on the pool: the one-spacing-wide tick
 * range, which currency the maker supplies (zeroForOne), and the range edge
 * nearest the current pool price — the tick whose display price the
 * orderbook API quotes for the order.
 */
export type LimitOrderTickRange = {
  nearEdgeTick: number;
  tickLower: number;
  tickUpper: number;
  zeroForOne: boolean;
};

/**
 * Maps a limit price to the maker order's tick range. The near edge lands on
 * the conservative side of the entered price — a bid never rests above it, an
 * ask never below it — then the range extends one tick spacing away from the
 * current pool price. `zeroForOne` records which sorted currency the maker
 * supplies: asks supply the outcome token, bids supply collateral, matching
 * the server's direction classification.
 */
export function buildLimitOrderTickRange({
  direction,
  outcomeIsCurrency0,
  priceWad,
}: {
  direction: VenueOrderDirection;
  outcomeIsCurrency0: boolean;
  priceWad: bigint;
}): LimitOrderTickRange {
  const spacing = COMPLETE_SET_PRICE_POLICY.tickSpacing;
  const zeroForOne = (direction === "ask") === outcomeIsCurrency0;
  // zeroForOne ranges rest above the current tick with the near edge at
  // tickLower, so the price tick rounds and aligns upward; the opposite
  // direction mirrors downward. Either way the near edge's display price
  // stays on the maker's conservative side of the entered price.
  const rounding: TickRounding = zeroForOne ? "up" : "down";
  const nearEdgeTick = alignTickToSpacing(
    displayPriceWadToTick({ displayPriceWad: priceWad, outcomeIsCurrency0, rounding }),
    spacing,
    rounding
  );

  return {
    nearEdgeTick,
    tickLower: zeroForOne ? nearEdgeTick : nearEdgeTick - spacing,
    tickUpper: zeroForOne ? nearEdgeTick + spacing : nearEdgeTick,
    zeroForOne,
  };
}

/**
 * Whether a maker order's range rests strictly beyond the current pool tick,
 * matching the order manager's one-sided validation: liquidity supplied as
 * currency0 must sit fully above the current tick, currency1 fully below.
 */
export function isRestingTickRange({
  currentTick,
  tickLower,
  tickUpper,
  zeroForOne,
}: {
  currentTick: number;
  tickLower: number;
  tickUpper: number;
  zeroForOne: boolean;
}): boolean {
  return zeroForOne ? currentTick < tickLower : currentTick > tickUpper;
}
