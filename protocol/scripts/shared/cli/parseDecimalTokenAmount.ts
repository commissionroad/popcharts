import { requireDecimals } from "../../../src/price/requireDecimals.js";

const DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/;

/**
 * Parses a decimal token-amount string from CLI or environment input into an
 * exact raw bigint for a token with `decimals` precision. Rejects non-decimal
 * input and fractional digits beyond the token's precision so no configured
 * amount is silently rounded; zero is rejected unless `allowZero` is set.
 */
export function parseDecimalTokenAmount(
  value: string,
  options: {
    readonly allowZero?: boolean;
    readonly decimals: number;
    readonly label: string;
  },
): bigint {
  const { allowZero = false, decimals, label } = options;
  requireDecimals(decimals, `${label} decimals`);

  const match = DECIMAL_PATTERN.exec(value.trim());
  if (match === null) {
    throw new Error(`Expected ${label} to be a non-negative decimal number, received "${value}".`);
  }

  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new Error(`Expected ${label} to use at most ${decimals} decimal places.`);
  }

  const scale = 10n ** BigInt(decimals);
  const amount = BigInt(whole) * scale + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (amount === 0n && !allowZero) {
    throw new Error(`Expected ${label} to be greater than zero.`);
  }
  return amount;
}
