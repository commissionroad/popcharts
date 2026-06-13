// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LmsrMath} from "../../../contracts/libraries/LmsrMath.sol";
import {MarketTypes} from "../../../contracts/types/MarketTypes.sol";

/// @title LmsrMathHarness
/// @author Pop Charts
/// @notice Exposes internal LMSR math helpers for Solidity tests.
contract LmsrMathHarness {
  /// @notice Exposes opening probability validation.
  /// @param probabilityWad Opening probability scaled by 1e18.
  function validateOpeningProbability(uint256 probabilityWad) external pure {
    LmsrMath.validateOpeningProbability(probabilityWad);
  }

  /// @notice Exposes liquidity parameter validation.
  /// @param liquidityParameter Virtual LMSR smoothness parameter.
  function validateLiquidityParameter(uint256 liquidityParameter) external pure {
    LmsrMath.validateLiquidityParameter(liquidityParameter);
  }

  /// @notice Exposes initial path computation.
  /// @param probabilityWad Opening YES probability scaled by 1e18.
  /// @param liquidityParameter Virtual LMSR smoothness parameter.
  /// @return Initial signed path coordinate.
  function openingPath(
    uint256 probabilityWad,
    uint256 liquidityParameter
  ) external pure returns (int256) {
    return LmsrMath.openingPath(probabilityWad, liquidityParameter);
  }

  /// @notice Exposes binary receipt quote computation.
  /// @param currentPath Current one-dimensional LMSR path coordinate.
  /// @param side YES or NO side to buy.
  /// @param shares Provisional share quantity to buy.
  /// @param liquidityParameter Virtual LMSR smoothness parameter.
  /// @return Receipt quote.
  function quoteBinaryReceipt(
    int256 currentPath,
    MarketTypes.Side side,
    uint256 shares,
    uint256 liquidityParameter
  ) external pure returns (MarketTypes.ReceiptQuote memory) {
    return LmsrMath.quoteBinaryReceipt(currentPath, side, shares, liquidityParameter);
  }
}
