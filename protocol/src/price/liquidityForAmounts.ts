const Q96 = 1n << 96n;
const MAX_UINT128 = (1n << 128n) - 1n;

/**
 * Bigint port of v4-periphery `LiquidityAmounts.getLiquidityForAmounts`: the
 * largest pool liquidity a range position can carry without pulling more than
 * `amount0Max` of currency0 or `amount1Max` of currency1 at the current pool
 * price. Smoke scripts use it to size dev backstop liquidity from explicit
 * token budgets instead of guessing a raw liquidity number.
 */
export function liquidityForAmounts(args: {
  readonly amount0Max: bigint;
  readonly amount1Max: bigint;
  readonly sqrtPriceLowerX96: bigint;
  readonly sqrtPriceUpperX96: bigint;
  readonly sqrtPriceX96: bigint;
}): bigint {
  const { amount0Max, amount1Max, sqrtPriceLowerX96, sqrtPriceUpperX96, sqrtPriceX96 } = args;
  if (sqrtPriceLowerX96 <= 0n || sqrtPriceX96 <= 0n) {
    throw new Error("Expected sqrt prices to be positive.");
  }
  if (sqrtPriceLowerX96 >= sqrtPriceUpperX96) {
    throw new Error(
      `Expected sqrtPriceLowerX96 ${sqrtPriceLowerX96} to be below ` +
        `sqrtPriceUpperX96 ${sqrtPriceUpperX96}.`,
    );
  }
  if (amount0Max < 0n || amount1Max < 0n) {
    throw new Error("Expected token amounts to be non-negative.");
  }

  let liquidity: bigint;
  if (sqrtPriceX96 <= sqrtPriceLowerX96) {
    liquidity = liquidityForAmount0(sqrtPriceLowerX96, sqrtPriceUpperX96, amount0Max);
  } else if (sqrtPriceX96 >= sqrtPriceUpperX96) {
    liquidity = liquidityForAmount1(sqrtPriceLowerX96, sqrtPriceUpperX96, amount1Max);
  } else {
    const liquidity0 = liquidityForAmount0(sqrtPriceX96, sqrtPriceUpperX96, amount0Max);
    const liquidity1 = liquidityForAmount1(sqrtPriceLowerX96, sqrtPriceX96, amount1Max);
    liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
  }

  return liquidity > MAX_UINT128 ? MAX_UINT128 : liquidity;
}

// Matches LiquidityAmounts.getLiquidityForAmount0 rounding so the resulting
// position never needs more currency0 than the caller budgeted.
function liquidityForAmount0(
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  amount0: bigint,
): bigint {
  const intermediate = (sqrtPriceAX96 * sqrtPriceBX96) / Q96;
  return (amount0 * intermediate) / (sqrtPriceBX96 - sqrtPriceAX96);
}

// Matches LiquidityAmounts.getLiquidityForAmount1 rounding for currency1.
function liquidityForAmount1(
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  amount1: bigint,
): bigint {
  return (amount1 * Q96) / (sqrtPriceBX96 - sqrtPriceAX96);
}
