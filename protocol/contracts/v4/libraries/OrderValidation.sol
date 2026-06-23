// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

/// @title OrderValidation
/// @author Pop Charts
/// @notice Validation helpers for bounded-pool one-sided orders.
library OrderValidation {
  /// @notice Reverts when tick spacing is not positive.
  /// @param tickSpacing Invalid tick spacing.
  error InvalidTickSpacing(int24 tickSpacing);
  /// @notice Reverts when a tick range is empty or inverted.
  /// @param tickLower Lower tick.
  /// @param tickUpper Upper tick.
  error InvalidTickRange(int24 tickLower, int24 tickUpper);
  /// @notice Reverts when a tick does not align to the pool spacing.
  /// @param tick Misaligned tick.
  /// @param tickSpacing Pool tick spacing.
  error TickNotAligned(int24 tick, int24 tickSpacing);
  /// @notice Reverts when an order range is not entirely on the expected side of the current tick.
  /// @param zeroForOne Whether the maker is selling currency0 for currency1.
  /// @param currentTick Current pool tick.
  /// @param tickLower Lower tick.
  /// @param tickUpper Upper tick.
  error InvalidOrderSide(bool zeroForOne, int24 currentTick, int24 tickLower, int24 tickUpper);

  /// @notice Validates a tick range against pool spacing.
  /// @param tickLower Lower tick.
  /// @param tickUpper Upper tick.
  /// @param tickSpacing Pool tick spacing.
  function validateTickRange(int24 tickLower, int24 tickUpper, int24 tickSpacing) internal pure {
    if (tickSpacing <= 0) {
      revert InvalidTickSpacing(tickSpacing);
    }
    if (tickLower >= tickUpper) {
      revert InvalidTickRange(tickLower, tickUpper);
    }
    if (tickLower % tickSpacing != 0) {
      revert TickNotAligned(tickLower, tickSpacing);
    }
    if (tickUpper % tickSpacing != 0) {
      revert TickNotAligned(tickUpper, tickSpacing);
    }
  }

  /// @notice Validates that an order can be created as one-sided liquidity.
  /// @param zeroForOne Whether the maker is selling currency0 for currency1.
  /// @param currentTick Current pool tick.
  /// @param tickLower Lower tick.
  /// @param tickUpper Upper tick.
  function validateOneSidedOrder(
    bool zeroForOne,
    int24 currentTick,
    int24 tickLower,
    int24 tickUpper
  ) internal pure {
    if (zeroForOne) {
      if (currentTick >= tickLower) {
        revert InvalidOrderSide(zeroForOne, currentTick, tickLower, tickUpper);
      }
    } else if (currentTick <= tickUpper) {
      revert InvalidOrderSide(zeroForOne, currentTick, tickLower, tickUpper);
    }
  }

  /// @notice Returns the tick that must be crossed for full-fill execution.
  /// @param zeroForOne Whether the maker is selling currency0 for currency1.
  /// @param tickLower Lower tick.
  /// @param tickUpper Upper tick.
  /// @return tick Full-fill threshold tick.
  function thresholdTick(
    bool zeroForOne,
    int24 tickLower,
    int24 tickUpper
  ) internal pure returns (int24 tick) {
    return zeroForOne ? tickUpper : tickLower;
  }

  /// @notice Returns whether a tick movement fully crossed an order.
  /// @param zeroForOne Whether the maker is selling currency0 for currency1.
  /// @param fromTick Pool tick before movement.
  /// @param toTick Pool tick after movement.
  /// @param tickLower Lower tick.
  /// @param tickUpper Upper tick.
  /// @return crossed Whether the movement crossed the full-fill threshold.
  function isThresholdCrossed(
    bool zeroForOne,
    int24 fromTick,
    int24 toTick,
    int24 tickLower,
    int24 tickUpper
  ) internal pure returns (bool crossed) {
    return
      zeroForOne
        ? fromTick < tickUpper && toTick >= tickUpper
        : fromTick > tickLower && toTick <= tickLower;
  }
}
