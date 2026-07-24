/**
 * WAD fixed-point conventions shared across the protocol, indexer, and app.
 * The contracts quote collateral amounts, probabilities, and LMSR parameters
 * as WAD-scaled bigints (18 implied decimals). The decode lives here, in one
 * place, so a price the indexer pushes and a price the app refetches are
 * derived by identical arithmetic (repo ADR 0021) — no drifting copies.
 */

/** One whole unit in WAD fixed-point: 10^18. */
export const WAD = 10n ** 18n;

/**
 * Decodes a WAD-scaled bigint to a JavaScript number, keeping the fractional
 * part. Splitting off the whole part before the float divide preserves
 * precision for values whose integer part exceeds 2^53, where a plain
 * `Number(value) / 1e18` would round the low digits away. Negative values
 * reconstruct correctly: bigint `/` truncates toward zero and `%` keeps the
 * dividend's sign, so the whole and fractional parts share a sign.
 */
export function wadToNumber(value: bigint): number {
  return Number(value / WAD) + Number(value % WAD) / Number(WAD);
}

/**
 * Decodes a WAD probability or display price to whole cents, rounding half up
 * and clamping into [1, 99] so a quote never renders at the 0/100 asymptotes.
 */
export function wadToCents(value: bigint): number {
  const cents = Number((value * 100n + WAD / 2n) / WAD);
  return Math.min(99, Math.max(1, cents));
}
