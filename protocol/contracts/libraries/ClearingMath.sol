// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ClearingMath
/// @author Pop Charts
/// @notice Small clearing helpers shared by graduation logic.
library ClearingMath {
  /// @notice Returns the smaller of two unsigned integers.
  /// @param left First value to compare.
  /// @param right Second value to compare.
  /// @return Smaller value.
  function min(uint256 left, uint256 right) internal pure returns (uint256) {
    return left < right ? left : right;
  }

  /// @notice Returns whether YES and NO demand both cover a path band.
  /// @param yesCovering YES-side demand covering the band.
  /// @param noCovering NO-side demand covering the band.
  /// @return True when both sides have nonzero coverage.
  function hasOpposingDemand(uint256 yesCovering, uint256 noCovering) internal pure returns (bool) {
    return yesCovering != 0 && noCovering != 0;
  }
}
