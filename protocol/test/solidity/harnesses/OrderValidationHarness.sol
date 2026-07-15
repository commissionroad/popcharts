// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

import {OrderValidation} from "../../../contracts/v4/libraries/OrderValidation.sol";

/// @title OrderValidationHarness
/// @author Pop Charts
/// @notice Exposes internal bounded-order validation helpers for Solidity tests.
contract OrderValidationHarness {
  /// @notice Exposes tick-range validation.
  /// @param tickLower Lower tick.
  /// @param tickUpper Upper tick.
  /// @param tickSpacing Pool tick spacing.
  function validateTickRange(int24 tickLower, int24 tickUpper, int24 tickSpacing) external pure {
    OrderValidation.validateTickRange(tickLower, tickUpper, tickSpacing);
  }

  /// @notice Exposes one-sided order validation.
  /// @param zeroForOne Whether the maker sells currency0 for currency1.
  /// @param currentTick Current pool tick.
  /// @param tickLower Lower tick.
  /// @param tickUpper Upper tick.
  function validateOneSidedOrder(
    bool zeroForOne,
    int24 currentTick,
    int24 tickLower,
    int24 tickUpper
  ) external pure {
    OrderValidation.validateOneSidedOrder(zeroForOne, currentTick, tickLower, tickUpper);
  }

  /// @notice Exposes partial-fill threshold selection.
  /// @param zeroForOne Whether the maker sells currency0 for currency1.
  /// @param tickLower Lower tick.
  /// @param tickUpper Upper tick.
  /// @return tick Partial-fill threshold tick.
  function partialThresholdTick(
    bool zeroForOne,
    int24 tickLower,
    int24 tickUpper
  ) external pure returns (int24 tick) {
    return OrderValidation.partialThresholdTick(zeroForOne, tickLower, tickUpper);
  }

  /// @notice Exposes full-fill threshold selection.
  /// @param zeroForOne Whether the maker sells currency0 for currency1.
  /// @param tickLower Lower tick.
  /// @param tickUpper Upper tick.
  /// @return tick Full-fill threshold tick.
  function thresholdTick(
    bool zeroForOne,
    int24 tickLower,
    int24 tickUpper
  ) external pure returns (int24 tick) {
    return OrderValidation.thresholdTick(zeroForOne, tickLower, tickUpper);
  }

  /// @notice Exposes full-threshold crossing detection.
  /// @param zeroForOne Whether the maker sells currency0 for currency1.
  /// @param fromTick Pool tick before movement.
  /// @param toTick Pool tick after movement.
  /// @param tickLower Lower tick.
  /// @param tickUpper Upper tick.
  /// @return crossed Whether the full-fill threshold was crossed.
  function isThresholdCrossed(
    bool zeroForOne,
    int24 fromTick,
    int24 toTick,
    int24 tickLower,
    int24 tickUpper
  ) external pure returns (bool crossed) {
    return OrderValidation.isThresholdCrossed(zeroForOne, fromTick, toTick, tickLower, tickUpper);
  }

  /// @notice Exposes indexed-tick crossing detection.
  /// @param zeroForOne Whether the maker sells currency0 for currency1.
  /// @param fromTick Pool tick before movement.
  /// @param toTick Pool tick after movement.
  /// @param indexedTick Tick where the order is indexed.
  /// @return crossed Whether the indexed tick was crossed.
  function isIndexedTickCrossed(
    bool zeroForOne,
    int24 fromTick,
    int24 toTick,
    int24 indexedTick
  ) external pure returns (bool crossed) {
    return OrderValidation.isIndexedTickCrossed(zeroForOne, fromTick, toTick, indexedTick);
  }
}
