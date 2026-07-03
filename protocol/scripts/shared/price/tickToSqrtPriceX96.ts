/** Lowest tick supported by v4-core TickMath. */
export const MIN_TICK = -887272;
/** Highest tick supported by v4-core TickMath. */
export const MAX_TICK = 887272;

const MAX_UINT256 = (1n << 256n) - 1n;
const UINT32_MASK = 0xffffffffn;
const ONE_Q128 = 0x100000000000000000000000000000000n;

// Per-bit sqrt(1.0001)^-(2^n) multipliers in Q128 from v4-core TickMath.
const TICK_RATIO_STEPS: readonly (readonly [bigint, bigint])[] = [
  [0x2n, 0xfff97272373d413259a46990580e213an],
  [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000n, 0x48a170391f7dc42444e8fa2n],
];

/**
 * Exact bigint port of v4-core `TickMath.getSqrtPriceAtTick`: the Q64.96
 * square-root price at a tick, so scripts derive the same boundary prices the
 * pool manager enforces onchain.
 */
export function tickToSqrtPriceX96(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error(`Tick ${tick} is outside the TickMath range [${MIN_TICK}, ${MAX_TICK}].`);
  }

  const absTick = BigInt(Math.abs(tick));
  let ratio = (absTick & 0x1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : ONE_Q128;
  for (const [bit, multiplier] of TICK_RATIO_STEPS) {
    if ((absTick & bit) !== 0n) {
      ratio = (ratio * multiplier) >> 128n;
    }
  }
  if (tick > 0) {
    ratio = MAX_UINT256 / ratio;
  }

  // Round up on truncation from Q128 to Q96, matching the Solidity source.
  return (ratio >> 32n) + ((ratio & UINT32_MASK) === 0n ? 0n : 1n);
}
