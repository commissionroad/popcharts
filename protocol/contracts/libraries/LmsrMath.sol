// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title LmsrMath
/// @author Pop Charts
/// @notice Validation and fixed-point constants for virtual LMSR math.
library LmsrMath {
  uint256 internal constant WAD = 1e18;

  error InvalidProbability(uint256 probabilityWad);
  error InvalidLiquidityParameter();

  function validateOpeningProbability(uint256 probabilityWad) internal pure {
    if (probabilityWad == 0 || probabilityWad >= WAD) {
      revert InvalidProbability(probabilityWad);
    }
  }

  function validateLiquidityParameter(uint256 liquidityParameter) internal pure {
    if (liquidityParameter == 0) {
      revert InvalidLiquidityParameter();
    }
  }
}
