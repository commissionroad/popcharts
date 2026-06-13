// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SD59x18, sd} from "@prb/math/src/SD59x18.sol";
import {MarketTypes} from "../types/MarketTypes.sol";

/// @title LmsrMath
/// @author Pop Charts
/// @notice Validation and fixed-point constants for virtual LMSR math.
library LmsrMath {
  uint256 internal constant WAD = 1e18;

  /// @notice Reverts when a probability is zero or not below 1e18.
  /// @param probabilityWad Probability value scaled by 1e18.
  error InvalidProbability(uint256 probabilityWad);
  /// @notice Reverts when the LMSR liquidity parameter is zero.
  error InvalidLiquidityParameter();
  /// @notice Reverts when a computed receipt quote cost is zero or negative.
  error QuoteCostTooSmall();
  /// @notice Reverts when an unsigned integer cannot be represented as a signed integer.
  /// @param value Unsigned integer that is too large to convert.
  error ValueTooLarge(uint256 value);

  /// @notice Validates that an opening probability is strictly between zero and one.
  /// @param probabilityWad Opening probability scaled by 1e18.
  function validateOpeningProbability(uint256 probabilityWad) internal pure {
    if (probabilityWad == 0 || probabilityWad >= WAD) {
      revert InvalidProbability(probabilityWad);
    }
  }

  /// @notice Validates that the LMSR liquidity parameter is nonzero.
  /// @param liquidityParameter Virtual LMSR smoothness parameter.
  function validateLiquidityParameter(uint256 liquidityParameter) internal pure {
    if (liquidityParameter == 0) {
      revert InvalidLiquidityParameter();
    }
  }

  /// @notice Computes the initial binary LMSR path coordinate for an opening probability.
  /// @param probabilityWad Opening YES probability scaled by 1e18.
  /// @param liquidityParameter Virtual LMSR smoothness parameter.
  /// @return Initial signed path coordinate.
  function openingPath(
    uint256 probabilityWad,
    uint256 liquidityParameter
  ) internal pure returns (int256) {
    validateOpeningProbability(probabilityWad);
    validateLiquidityParameter(liquidityParameter);

    SD59x18 probability = _toSd(probabilityWad);
    SD59x18 complement = _toSd(WAD - probabilityWad);

    return (_toSd(liquidityParameter) * (probability / complement).ln()).unwrap();
  }

  /// @notice Quotes the cost and path interval for a binary YES or NO receipt.
  /// @param currentPath Current one-dimensional LMSR path coordinate.
  /// @param side YES or NO side to buy.
  /// @param shares Provisional share quantity to buy.
  /// @param liquidityParameter Virtual LMSR smoothness parameter.
  /// @return quote Receipt cost and traversed path interval.
  function quoteBinaryReceipt(
    int256 currentPath,
    MarketTypes.Side side,
    uint256 shares,
    uint256 liquidityParameter
  ) internal pure returns (MarketTypes.ReceiptQuote memory quote) {
    validateLiquidityParameter(liquidityParameter);

    int256 signedShares = _toInt(shares);
    SD59x18 sharesAmount = sd(signedShares);
    SD59x18 beforeCost = _lmsrCost(currentPath, liquidityParameter);
    SD59x18 receiptCost;

    if (side == MarketTypes.Side.Yes) {
      quote.rLow = currentPath;
      quote.rHigh = currentPath + signedShares;
      receiptCost = _lmsrCost(quote.rHigh, liquidityParameter) - beforeCost;
    } else {
      quote.rLow = currentPath - signedShares;
      quote.rHigh = currentPath;
      receiptCost = sharesAmount + _lmsrCost(quote.rLow, liquidityParameter) - beforeCost;
    }

    quote.cost = _toPositiveUint(receiptCost);
  }

  /// @notice Computes the binary LMSR cost function at a path coordinate.
  /// @param path One-dimensional LMSR path coordinate.
  /// @param liquidityParameter Virtual LMSR smoothness parameter.
  /// @return Cost function value as signed 59.18 fixed point.
  function _lmsrCost(int256 path, uint256 liquidityParameter) private pure returns (SD59x18) {
    SD59x18 b = _toSd(liquidityParameter);
    return b * _softplus(sd(path) / b);
  }

  /// @notice Computes ln(1 + exp(value)) in a numerically stable branch.
  /// @param value Signed 59.18 fixed-point input.
  /// @return Softplus result as signed 59.18 fixed point.
  function _softplus(SD59x18 value) private pure returns (SD59x18) {
    SD59x18 one = sd(int256(WAD));

    if (value.unwrap() > 0) {
      return value + (one + (-value).exp()).ln();
    }

    return (one + value.exp()).ln();
  }

  /// @notice Converts a positive signed fixed-point value to uint256.
  /// @param value Signed 59.18 fixed-point value.
  /// @return Unsigned integer representation.
  function _toPositiveUint(SD59x18 value) private pure returns (uint256) {
    int256 rawValue = value.unwrap();
    if (rawValue <= 0) {
      revert QuoteCostTooSmall();
    }

    return uint256(rawValue);
  }

  /// @notice Converts an unsigned 18-decimal fixed-point value to signed 59.18 fixed point.
  /// @param value Unsigned 18-decimal fixed-point value.
  /// @return Signed 59.18 fixed-point value.
  function _toSd(uint256 value) private pure returns (SD59x18) {
    return sd(_toInt(value));
  }

  /// @notice Converts uint256 to int256 after checking the signed range.
  /// @param value Unsigned integer to convert.
  /// @return Signed integer representation.
  function _toInt(uint256 value) private pure returns (int256) {
    if (value > uint256(type(int256).max)) {
      revert ValueTooLarge(value);
    }

    return int256(value);
  }
}
