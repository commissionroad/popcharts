// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

import {TickMath} from "@uniswap/v4-periphery/lib/v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "@uniswap/v4-periphery/lib/v4-core/src/types/BalanceDelta.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {OrderValidation} from "./OrderValidation.sol";
import {V4DeltaSettlement} from "./V4DeltaSettlement.sol";

/// @title PartialFillMath
/// @author Pop Charts
/// @notice Pure tick and liquidity math for partially filled bounded orders:
///   remaining range and indexed-tick derivation, remaining-liquidity
///   conversion from removal deltas, threshold selection, and tick-spacing
///   rounding. No storage and no pool calls — callers apply the results.
library PartialFillMath {
  function remainingRange(
    int24 tickSpacing,
    bool zeroForOne,
    int24 orderTickLower,
    int24 orderTickUpper,
    int24 toTick
  ) internal pure returns (int24 tickLower, int24 tickUpper, int24 indexedTick) {
    if (zeroForOne) {
      tickLower = ceilToSpacing(toTick, tickSpacing);
      if (tickLower < orderTickLower) {
        tickLower = orderTickLower;
      }
      tickUpper = orderTickUpper;
      if (tickLower >= tickUpper) {
        return (tickUpper, tickUpper, tickUpper);
      }

      indexedTick = tickLower;
      if (toTick == tickLower) {
        indexedTick = tickLower + tickSpacing;
      }
      if (indexedTick > tickUpper) {
        indexedTick = tickUpper;
      }
      return (tickLower, tickUpper, indexedTick);
    }

    tickLower = orderTickLower;
    tickUpper = floorToSpacing(toTick, tickSpacing);
    if (tickUpper > orderTickUpper) {
      tickUpper = orderTickUpper;
    }
    if (tickUpper <= tickLower) {
      return (tickLower, tickLower, tickLower);
    }

    indexedTick = tickUpper;
    if (toTick == tickUpper) {
      indexedTick = tickUpper - tickSpacing;
    }
    if (indexedTick < tickLower) {
      indexedTick = tickLower;
    }
  }

  function remainingLiquidity(
    bool zeroForOne,
    int24 tickLower,
    int24 tickUpper,
    BalanceDelta removedDelta
  ) internal pure returns (uint128) {
    if (tickLower >= tickUpper) {
      return 0;
    }

    uint256 remainingInputAmount =
      zeroForOne
        ? V4DeltaSettlement.positiveDeltaAmount0(removedDelta)
        : V4DeltaSettlement.positiveDeltaAmount1(removedDelta);
    if (remainingInputAmount == 0) {
      return 0;
    }

    return liquidityForAmount(zeroForOne, tickLower, tickUpper, remainingInputAmount);
  }

  function liquidityForAmount(
    bool zeroForOne,
    int24 tickLower,
    int24 tickUpper,
    uint256 amount
  ) internal pure returns (uint128 liquidity) {
    uint160 sqrtPriceLower = TickMath.getSqrtPriceAtTick(tickLower);
    uint160 sqrtPriceUpper = TickMath.getSqrtPriceAtTick(tickUpper);
    if (zeroForOne) {
      return LiquidityAmounts.getLiquidityForAmount0(sqrtPriceLower, sqrtPriceUpper, amount);
    }

    return LiquidityAmounts.getLiquidityForAmount1(sqrtPriceLower, sqrtPriceUpper, amount);
  }

  function initialIndexedTick(
    bool zeroForOne,
    int24 tickLower,
    int24 tickUpper,
    bool enablePartialFill
  ) internal pure returns (int24 indexedTick) {
    if (enablePartialFill) {
      return OrderValidation.partialThresholdTick(zeroForOne, tickLower, tickUpper);
    }

    return OrderValidation.thresholdTick(zeroForOne, tickLower, tickUpper);
  }

  function ceilToSpacing(int24 tick, int24 tickSpacing) internal pure returns (int24) {
    int24 floorTick = floorToSpacing(tick, tickSpacing);
    if (floorTick == tick) {
      return floorTick;
    }

    return floorTick + tickSpacing;
  }

  function floorToSpacing(int24 tick, int24 tickSpacing) internal pure returns (int24) {
    if (tickSpacing <= 0) {
      revert OrderValidation.InvalidTickSpacing(tickSpacing);
    }

    int256 tickValue = int256(tick);
    int256 spacingValue = int256(tickSpacing);
    int256 quotient = tickValue / spacingValue;
    if (tickValue < 0 && tickValue % spacingValue != 0) {
      --quotient;
    }

    return int24(quotient * spacingValue);
  }
}
