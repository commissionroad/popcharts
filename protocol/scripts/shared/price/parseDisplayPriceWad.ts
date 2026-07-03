const WAD_DECIMALS = 18;
const WAD = 10n ** 18n;
const DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/;

/**
 * Parses a decimal display-price string (collateral per one outcome token)
 * into an exact WAD-scaled bigint. Rejects non-decimal input, zero, and more
 * than 18 fractional digits so no configured price is silently rounded.
 */
export function parseDisplayPriceWad(value: string, label: string): bigint {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (match === null) {
    throw new Error(`Expected ${label} to be a positive decimal number, received "${value}".`);
  }

  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > WAD_DECIMALS) {
    throw new Error(`Expected ${label} to use at most ${WAD_DECIMALS} decimal places.`);
  }

  const priceWad = BigInt(whole) * WAD + BigInt(fraction.padEnd(WAD_DECIMALS, "0") || "0");
  if (priceWad === 0n) {
    throw new Error(`Expected ${label} to be greater than zero.`);
  }
  return priceWad;
}
