import { WAD, wadToNumber } from "@/domain/tokens/wad";

import { MAX_VENUE_TRADE_AMOUNT, type VenueTradeAction } from "./venue-trade";

/**
 * Which side of the book a maker order rests on: an ask sells outcome tokens
 * for collateral, a bid deposits collateral to buy outcome tokens. Mirrors
 * the orderbook API's direction field.
 */
export type VenueOrderDirection = "ask" | "bid";

/** The book direction a ticket action maps to: buys bid, sells ask. */
export function limitOrderDirection(action: VenueTradeAction): VenueOrderDirection {
  return action === "buy" ? "bid" : "ask";
}

/** Converts a whole-cent limit price to the WAD display price it targets. */
export function limitPriceCentsToWad(cents: number): bigint {
  return (BigInt(cents) * WAD) / 100n;
}

/** A WAD display price expressed in cents for formatting. */
export function wadPriceToCents(priceWad: bigint): number {
  return wadToNumber(priceWad) * 100;
}

/**
 * Parses the ticket's limit-price input. Returns the whole-cent price, or
 * null when the value is not an integer between 1 and 99.
 */
export function parseLimitPriceCents(input: string): number | null {
  if (!/^\d{1,2}$/.test(input.trim())) {
    return null;
  }

  const cents = Number.parseInt(input, 10);

  return cents >= 1 && cents <= 99 ? cents : null;
}

/**
 * Validation message for the limit-price input, or null when it is a whole
 * cent between 1 and 99.
 */
export function getLimitPriceError(input: string): string | null {
  if (input.trim() === "") {
    return "Enter a limit price in cents.";
  }

  if (parseLimitPriceCents(input) === null) {
    return "Limit price must be a whole number of cents from 1 to 99.";
  }

  return null;
}

/**
 * Validation message for the limit-order size input, or null when the size
 * is a positive token amount within the per-trade cap.
 */
export function getLimitSizeError(input: string): string | null {
  const parsed = Number.parseFloat(input);

  if (!Number.isFinite(parsed)) {
    return "Enter a token amount.";
  }

  if (parsed <= 0) {
    return "Size must be greater than zero.";
  }

  if (parsed > MAX_VENUE_TRADE_AMOUNT) {
    return "Size is above the per-trade limit.";
  }

  return null;
}

/**
 * Blocking message when a limit order would fill immediately instead of
 * resting: a bid must sit below the current pool price and an ask above it.
 * The venue's book only holds resting orders — marketable limits are exactly
 * what the market-order ticket is for.
 */
export function getLimitRestingError({
  direction,
  poolPriceWad,
  priceWad,
}: {
  direction: VenueOrderDirection;
  poolPriceWad: bigint;
  priceWad: bigint;
}): string | null {
  if (direction === "bid" && priceWad >= poolPriceWad) {
    return "A buy limit at or above the current price would fill immediately. Lower the price, or use a market order.";
  }

  if (direction === "ask" && priceWad <= poolPriceWad) {
    return "A sell limit at or below the current price would fill immediately. Raise the price, or use a market order.";
  }

  return null;
}

/**
 * The maker's deposit for a limit order: bids escrow collateral worth
 * size x price (rounded up so dust-sized orders never round to zero), asks
 * escrow the outcome tokens being sold.
 */
export function limitOrderDepositWad({
  direction,
  priceWad,
  sizeWad,
}: {
  direction: VenueOrderDirection;
  priceWad: bigint;
  sizeWad: bigint;
}): bigint {
  if (direction === "ask") {
    return sizeWad;
  }

  const product = sizeWad * priceWad;

  return product / WAD + (product % WAD === 0n ? 0n : 1n);
}

/**
 * Whether the pool price has crossed a resting order's price, meaning fills
 * are due. Crossed orders can stay briefly open while the keeper resolves
 * deferred executions, so the panel shows them as filling rather than
 * promising an instant fill.
 */
export function isVenueOrderCrossed({
  direction,
  poolPriceWad,
  priceWad,
}: {
  direction: VenueOrderDirection;
  poolPriceWad: bigint;
  priceWad: bigint;
}): boolean {
  return direction === "bid" ? poolPriceWad <= priceWad : poolPriceWad >= priceWad;
}
