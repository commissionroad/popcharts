// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ReceiptBands
/// @author Pop Charts
/// @notice Helpers for receipt path-band arithmetic.
library ReceiptBands {
  /// @notice Reverts when a path band has no positive width.
  /// @param lower Lower path endpoint.
  /// @param upper Upper path endpoint.
  error EmptyBand(int256 lower, int256 upper);

  /// @notice Returns the positive width of a path band.
  /// @param lower Lower path endpoint.
  /// @param upper Upper path endpoint.
  /// @return Positive band width.
  function width(int256 lower, int256 upper) internal pure returns (uint256) {
    if (upper <= lower) {
      revert EmptyBand(lower, upper);
    }

    return uint256(upper - lower);
  }

  /// @notice Returns whether two half-open path intervals overlap.
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
  ) internal pure returns (bool) {
    return leftLower < rightUpper && rightLower < leftUpper;
  }
}
