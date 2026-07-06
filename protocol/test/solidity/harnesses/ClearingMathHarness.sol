// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ClearingMath} from "../../../contracts/libraries/ClearingMath.sol";

/// @title ClearingMathHarness
/// @author Pop Charts
/// @notice Exposes internal clearing helpers for Solidity tests.
contract ClearingMathHarness {
  /// @notice Exposes the unsigned minimum helper.
  /// @param left First value to compare.
  /// @param right Second value to compare.
  /// @return Smaller value.
  function min(uint256 left, uint256 right) external pure returns (uint256) {
    return ClearingMath.min(left, right);
  }

  /// @notice Exposes the opposing-demand check.
  /// @param yesCovering YES-side demand covering the band.
  /// @param noCovering NO-side demand covering the band.
  /// @return True when both sides have nonzero coverage.
  function hasOpposingDemand(uint256 yesCovering, uint256 noCovering) external pure returns (bool) {
    return ClearingMath.hasOpposingDemand(yesCovering, noCovering);
  }
}
