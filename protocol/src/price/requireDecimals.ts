// Largest n for which 10^n still fits in an EVM uint256 (10^77 < 2^256 <
// 10^78), so any decimals beyond it could never scale a raw token amount
// without overflowing on chain.
export const MAX_SUPPORTED_DECIMALS = 77;

/**
 * Asserts a token-decimals value is an integer in the EVM-representable
 * range before it is used as a power-of-ten scale factor.
 */
export function requireDecimals(decimals: number, label: string): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_SUPPORTED_DECIMALS) {
    throw new Error(`Expected ${label} to be an integer in [0, ${MAX_SUPPORTED_DECIMALS}].`);
  }
}
