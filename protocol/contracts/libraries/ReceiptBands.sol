// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ReceiptBands
/// @author Pop Charts
/// @notice Helpers for receipt path-band arithmetic.
library ReceiptBands {
  error EmptyBand(int256 lower, int256 upper);

  function width(int256 lower, int256 upper) internal pure returns (uint256) {
    if (upper <= lower) {
      revert EmptyBand(lower, upper);
    }

    return uint256(upper - lower);
  }

  function overlaps(
    int256 leftLower,
    int256 leftUpper,
    int256 rightLower,
    int256 rightUpper
  ) internal pure returns (bool) {
    return leftLower < rightUpper && rightLower < leftUpper;
  }
}
