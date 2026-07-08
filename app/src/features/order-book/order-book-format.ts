/**
 * Formats a ladder price in cents in the house "64c" style, keeping one
 * decimal when the tick edge lands between whole cents ("63.5c").
 */
export function formatLadderCents(value: number) {
  const rounded = Math.round(value * 10) / 10;

  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}c`;
}

/**
 * Formats an outcome-share quantity with separators, showing two decimals
 * only below 100 where they matter ("1,250", "42.50").
 */
export function formatLadderShares(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 2,
    minimumFractionDigits: value > 0 && value < 100 ? 2 : 0,
  });
}
