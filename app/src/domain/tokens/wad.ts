/**
 * Shared on-chain fixed-point conventions. The protocol quotes collateral
 * amounts, probabilities, and LMSR parameters as WAD-scaled bigints (18
 * implied decimals), and the collateral token itself uses 18 decimals.
 */

/** Decimals used by the collateral token and WAD fixed-point values. */
export const TOKEN_DECIMALS = 18;

/** One whole unit in WAD fixed-point: 10^18. */
export const WAD = 10n ** 18n;

/**
 * Converts a WAD-scaled bigint to a JavaScript number, keeping the
 * fractional part (subject to ordinary float precision).
 */
export function wadToNumber(value: bigint) {
  return Number(value / WAD) + Number(value % WAD) / Number(WAD);
}
