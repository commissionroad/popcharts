// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SD59x18, sd} from "@prb/math/src/SD59x18.sol";
import {MarketTypes} from "../types/MarketTypes.sol";

/// @title LmsrMath
/// @author Pop Charts
/// @notice Validation and fixed-point constants for virtual LMSR math.
library LmsrMath {
  uint256 internal constant WAD = 1e18;

  error InvalidProbability(uint256 probabilityWad);
  error InvalidLiquidityParameter();
  error QuoteCostTooSmall();
  error ValueTooLarge(uint256 value);

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

  function _lmsrCost(int256 path, uint256 liquidityParameter) private pure returns (SD59x18) {
    SD59x18 b = _toSd(liquidityParameter);
    return b * _softplus(sd(path) / b);
  }

  function _softplus(SD59x18 value) private pure returns (SD59x18) {
    SD59x18 one = sd(int256(WAD));

    if (value.unwrap() > 0) {
      return value + (one + (-value).exp()).ln();
    }

    return (one + value.exp()).ln();
  }

  function _toPositiveUint(SD59x18 value) private pure returns (uint256) {
    int256 rawValue = value.unwrap();
    if (rawValue <= 0) {
      revert QuoteCostTooSmall();
    }

    return uint256(rawValue);
  }

  function _toSd(uint256 value) private pure returns (SD59x18) {
    return sd(_toInt(value));
  }

  function _toInt(uint256 value) private pure returns (int256) {
    if (value > uint256(type(int256).max)) {
      revert ValueTooLarge(value);
    }

    return int256(value);
  }
}
