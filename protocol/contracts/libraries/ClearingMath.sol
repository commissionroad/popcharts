// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ClearingMath
/// @author Pop Charts
/// @notice Small clearing helpers shared by graduation logic.
library ClearingMath {
  function min(uint256 left, uint256 right) internal pure returns (uint256) {
    return left < right ? left : right;
  }

  function hasOpposingDemand(uint256 yesCovering, uint256 noCovering) internal pure returns (bool) {
    return yesCovering != 0 && noCovering != 0;
  }
}
