import { COMPLETE_SET_PRICE_POLICY } from "@popcharts/protocol/complete-set-price-policy";

import type { Market, MarketSide } from "@/domain/markets/types";
import { WAD, wadToNumber } from "@/domain/tokens/wad";

/** Direction of a postgrad venue trade: buy or sell outcome tokens. */
export type VenueTradeAction = "buy" | "sell";

/** Per-trade cap on the amount input, matching the pregrad budget limit. */
export const MAX_VENUE_TRADE_AMOUNT = 1_000_000;

/** v4 pool fees are expressed in hundredths of a basis point (pips). */
const FEE_PIPS_DENOMINATOR = 1_000_000n;

/**
 * A preview of a venue market order: the exact input amount, the expected
 * output amount (from the v4 quoter, or estimated off the pool's display
 * price when no quoter is configured), and the resulting effective price next
 * to the current pool price. Buys spend collateral for outcome tokens; sells
 * spend outcome tokens for collateral.
 */
export type VenueSwapQuote = {
  action: VenueTradeAction;
  amountIn: bigint;
  amountOut: bigint;
  effectivePriceCents: number;
  poolPriceCents: number;
  side: MarketSide;
  source: "estimate" | "quoter";
};

/**
 * Parses the ticket's amount input. Returns null when the value is not a
 * finite number.
 */
export function parseVenueTradeAmount(amount: string) {
  const parsed = Number.parseFloat(amount);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

/**
 * Validation message for the ticket's amount input, or null when the amount
 * is tradable. The empty-input copy names the unit being entered: collateral
 * for buys, outcome tokens for sells.
 */
export function getVenueTradeAmountError(amount: string, action: VenueTradeAction) {
  const parsed = parseVenueTradeAmount(amount);

  if (parsed === null) {
    return action === "buy" ? "Enter a collateral amount." : "Enter a token amount.";
  }

  if (parsed <= 0) {
    return "Amount must be greater than zero.";
  }

  if (parsed > MAX_VENUE_TRADE_AMOUNT) {
    return "Amount is above the per-trade limit.";
  }

  return null;
}

/**
 * Converts a user-entered amount to 18-decimal token units. Both the
 * collateral and ADR 0009 outcome tokens use 18 decimals. Amounts are capped
 * at MAX_VENUE_TRADE_AMOUNT upstream, so 8 decimal places of float precision
 * stay exact here.
 */
export function toVenueTokenUnits(value: number) {
  return BigInt(Math.round(value * 1e8)) * 10n ** 10n;
}

/** Converts 18-decimal token units back to a display number. */
export function venueTokenUnitsToNumber(units: bigint) {
  return wadToNumber(units);
}

/**
 * The current pool price for one side of a graduated market as a WAD
 * (collateral per outcome token). Prefers the live venue pool's display
 * price; falls back to the market's headline cents price, which already
 * mirrors the venue for graduated markets.
 */
export function poolPriceWadForSide(market: Market, side: MarketSide): bigint {
  const pool =
    side === "yes" ? market.postgrad?.venue?.yesPool : market.postgrad?.venue?.noPool;

  if (pool?.displayPriceWad) {
    return BigInt(pool.displayPriceWad);
  }

  const cents = side === "yes" ? market.yesPriceCents : market.noPriceCents;

  return BigInt(Math.round(cents * 1e6)) * 10n ** 10n;
}

/**
 * Estimates a swap's output from the pool's current display price when no
 * quoter is available: the pool fee comes off the input, then the remainder
 * converts at the display price (collateral per outcome token). Ignores price
 * impact, which is why quotes built from it are labeled estimates.
 */
export function estimateVenueSwapOutput({
  action,
  amountIn,
  poolPriceWad,
}: {
  action: VenueTradeAction;
  amountIn: bigint;
  poolPriceWad: bigint;
}) {
  if (poolPriceWad <= 0n) {
    return 0n;
  }

  const netIn =
    (amountIn * (FEE_PIPS_DENOMINATOR - BigInt(COMPLETE_SET_PRICE_POLICY.poolFee))) /
    FEE_PIPS_DENOMINATOR;

  return action === "buy" ? (netIn * WAD) / poolPriceWad : (netIn * poolPriceWad) / WAD;
}

/**
 * Assembles the ticket's quote preview from an input/output amount pair. The
 * effective price is the all-in collateral paid or received per outcome
 * token; a zero token amount falls back to the pool price so the preview
 * never divides by zero.
 */
export function buildVenueSwapQuote({
  action,
  amountIn,
  amountOut,
  poolPriceWad,
  side,
  source,
}: {
  action: VenueTradeAction;
  amountIn: bigint;
  amountOut: bigint;
  poolPriceWad: bigint;
  side: MarketSide;
  source: VenueSwapQuote["source"];
}): VenueSwapQuote {
  const poolPriceCents = wadToNumber(poolPriceWad) * 100;
  const collateral = wadToNumber(action === "buy" ? amountIn : amountOut);
  const tokens = wadToNumber(action === "buy" ? amountOut : amountIn);

  return {
    action,
    amountIn,
    amountOut,
    effectivePriceCents: tokens > 0 ? (collateral / tokens) * 100 : poolPriceCents,
    poolPriceCents,
    side,
    source,
  };
}
