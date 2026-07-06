// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReceiptBands} from "../../../contracts/libraries/ReceiptBands.sol";

/// @title ReceiptBandsHarness
/// @author Pop Charts
/// @notice Exposes internal receipt band helpers for Solidity tests.
contract ReceiptBandsHarness {
  /// @notice Exposes band width computation.
  /// @param lower Lower path endpoint.
  /// @param upper Upper path endpoint.
  /// @return Positive band width.
  function width(int256 lower, int256 upper) external pure returns (uint256) {
    return ReceiptBands.width(lower, upper);
  }

  /// @notice Exposes half-open interval overlap detection.
  /// @param leftLower Lower endpoint of the left interval.
  /// @param leftUpper Upper endpoint of the left interval.
  /// @param rightLower Lower endpoint of the right interval.
  /// @param rightUpper Upper endpoint of the right interval.
  /// @return True if the intervals overlap.
  function overlaps(
    int256 leftLower,
    int256 leftUpper,
    int256 rightLower,
    int256 rightUpper
  ) external pure returns (bool) {
    return ReceiptBands.overlaps(leftLower, leftUpper, rightLower, rightUpper);
  }
}
