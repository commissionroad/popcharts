// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

import {
  BalanceDelta,
  toBalanceDelta
} from "@uniswap/v4-periphery/lib/v4-core/src/types/BalanceDelta.sol";
import {PartialFillMath} from "../../../contracts/v4/libraries/PartialFillMath.sol";

/// @title PartialFillMathHarness
/// @author Pop Charts
/// @notice Exposes internal partial-fill math helpers for Solidity tests.
contract PartialFillMathHarness {
  /// @notice Exposes remaining-range derivation.
  /// @param tickSpacing Pool tick spacing.
  /// @param zeroForOne Whether the maker sells currency0 for currency1.
  /// @param orderTickLower Original order lower tick.
  /// @param orderTickUpper Original order upper tick.
  /// @param toTick Tick reached by the pool movement.
  /// @return tickLower Remaining lower tick.
  /// @return tickUpper Remaining upper tick.
  /// @return indexedTick Tick where the remaining order should be indexed.
  function remainingRange(
    int24 tickSpacing,
    bool zeroForOne,
    int24 orderTickLower,
    int24 orderTickUpper,
    int24 toTick
  ) external pure returns (int24 tickLower, int24 tickUpper, int24 indexedTick) {
    return
      PartialFillMath.remainingRange(
        tickSpacing,
        zeroForOne,
        orderTickLower,
        orderTickUpper,
        toTick
      );
  }

  /// @notice Exposes remaining-liquidity calculation.
  /// @param zeroForOne Whether the maker sells currency0 for currency1.
  /// @param tickLower Remaining lower tick.
  /// @param tickUpper Remaining upper tick.
  /// @param amount0 Removed currency0 delta.
  /// @param amount1 Removed currency1 delta.
  /// @return liquidity Remaining position liquidity.
  function remainingLiquidity(
    bool zeroForOne,
    int24 tickLower,
    int24 tickUpper,
    int128 amount0,
    int128 amount1
  ) external pure returns (uint128 liquidity) {
    BalanceDelta delta = toBalanceDelta(amount0, amount1);
    return PartialFillMath.remainingLiquidity(zeroForOne, tickLower, tickUpper, delta);
  }

  /// @notice Exposes one-sided liquidity calculation.
  /// @param zeroForOne Whether the amount is currency0 or currency1.
  /// @param tickLower Position lower tick.
  /// @param tickUpper Position upper tick.
  /// @param amount One-sided token amount.
  /// @return liquidity Position liquidity represented by the amount.
  function liquidityForAmount(
    bool zeroForOne,
    int24 tickLower,
    int24 tickUpper,
    uint256 amount
  ) external pure returns (uint128 liquidity) {
    return PartialFillMath.liquidityForAmount(zeroForOne, tickLower, tickUpper, amount);
  }

  /// @notice Exposes initial indexed-tick selection.
  /// @param zeroForOne Whether the maker sells currency0 for currency1.
  /// @param tickLower Order lower tick.
  /// @param tickUpper Order upper tick.
  /// @param enablePartialFill Whether partial filling is enabled.
  /// @return indexedTick Initial execution index.
  function initialIndexedTick(
    bool zeroForOne,
    int24 tickLower,
    int24 tickUpper,
    bool enablePartialFill
  ) external pure returns (int24 indexedTick) {
    return PartialFillMath.initialIndexedTick(zeroForOne, tickLower, tickUpper, enablePartialFill);
  }

  /// @notice Exposes upward tick-spacing rounding.
  /// @param tick Tick to round.
  /// @param tickSpacing Pool tick spacing.
  /// @return roundedTick Smallest aligned tick greater than or equal to the input.
  function ceilToSpacing(int24 tick, int24 tickSpacing) external pure returns (int24 roundedTick) {
    return PartialFillMath.ceilToSpacing(tick, tickSpacing);
  }

  /// @notice Exposes downward tick-spacing rounding.
  /// @param tick Tick to round.
  /// @param tickSpacing Pool tick spacing.
  /// @return roundedTick Greatest aligned tick less than or equal to the input.
  function floorToSpacing(int24 tick, int24 tickSpacing) external pure returns (int24 roundedTick) {
    return PartialFillMath.floorToSpacing(tick, tickSpacing);
  }
}
