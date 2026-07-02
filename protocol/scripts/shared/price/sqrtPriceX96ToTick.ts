import { tickToSqrtPriceX96 } from "./tickToSqrtPriceX96.js";

const MIN_SQRT_PRICE_X96 = 4295128739n;
const MAX_SQRT_PRICE_X96 = 1461446703485210103287273052203988822378723970342n;

// Most-significant-bit ladder from v4-core BitMath.mostSignificantBit.
const MSB_STEPS: readonly (readonly [bigint, bigint])[] = [
  [0xffffffffffffffffffffffffffffffffn, 128n],
  [0xffffffffffffffffn, 64n],
  [0xffffffffn, 32n],
  [0xffffn, 16n],
  [0xffn, 8n],
  [0xfn, 4n],
  [0x3n, 2n],
  [0x1n, 1n],
];

const LOG_SQRT_10001_MULTIPLIER = 255738958999603826347141n;
const TICK_LOW_ERROR_MARGIN = 3402992956809132418596140100660247210n;
const TICK_HIGH_ERROR_MARGIN = 291339464771989622907027621153398088495n;

/**
 * Exact bigint port of v4-core `TickMath.getTickAtSqrtPrice`: the greatest
 * tick whose sqrt price is at or below `sqrtPriceX96`, i.e. the floor tick of
 * a price. Callers needing round-up semantics compare against
 * `tickToSqrtPriceX96` and step one tick higher.
 */
export function sqrtPriceX96ToTick(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 < MIN_SQRT_PRICE_X96 || sqrtPriceX96 >= MAX_SQRT_PRICE_X96) {
    throw new Error(
      `sqrtPriceX96 ${sqrtPriceX96} is outside the TickMath range ` +
        `[${MIN_SQRT_PRICE_X96}, ${MAX_SQRT_PRICE_X96}).`,
    );
  }

  const ratio = sqrtPriceX96 << 32n;
  let r = ratio;
  let msb = 0n;
  for (const [threshold, shift] of MSB_STEPS) {
    if (r > threshold) {
      msb += shift;
      r >>= shift;
    }
  }

  r = msb >= 128n ? ratio >> (msb - 127n) : ratio << (127n - msb);
  let log2 = (msb - 128n) << 64n;
  for (let bit = 63n; bit >= 50n; --bit) {
    r = (r * r) >> 127n;
    const f = r >> 128n;
    log2 |= f << bit;
    r >>= f;
  }

  const logSqrt10001 = log2 * LOG_SQRT_10001_MULTIPLIER;
  const tickLow = Number((logSqrt10001 - TICK_LOW_ERROR_MARGIN) >> 128n);
  const tickHigh = Number((logSqrt10001 + TICK_HIGH_ERROR_MARGIN) >> 128n);
  if (tickLow === tickHigh) {
    return tickLow;
  }
  return tickToSqrtPriceX96(tickHigh) <= sqrtPriceX96 ? tickHigh : tickLow;
}
