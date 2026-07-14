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
