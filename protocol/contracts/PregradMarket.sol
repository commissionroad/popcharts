// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPregradMarket} from "./interfaces/IPregradMarket.sol";
import {LmsrMath} from "./libraries/LmsrMath.sol";
import {MarketTypes} from "./types/MarketTypes.sol";

/// @title PregradMarket
/// @author Pop Charts
/// @notice Stores bootstrap configuration for one virtual LMSR market.
contract PregradMarket is IPregradMarket {
  error InvalidCollateral();
  error InvalidCreator();
  error InvalidCloseTime();

  MarketTypes.MarketConfig private _config;
  /// @notice Current market lifecycle status.
  MarketTypes.MarketStatus public override status;

  /// @notice Deploys a market in Bootstrap status with immutable config.
  /// @param config_ Immutable market configuration.
  constructor(MarketTypes.MarketConfig memory config_) {
    if (config_.collateral == address(0)) {
      revert InvalidCollateral();
    }
    if (config_.creator == address(0)) {
      revert InvalidCreator();
    }
    if (config_.closeTime <= block.timestamp) {
      revert InvalidCloseTime();
    }

    LmsrMath.validateOpeningProbability(config_.openingProbabilityWad);
    LmsrMath.validateLiquidityParameter(config_.liquidityParameter);

    _config = config_;
    status = MarketTypes.MarketStatus.Bootstrap;
  }

  /// @inheritdoc IPregradMarket
  function getConfig() external view override returns (MarketTypes.MarketConfig memory) {
    return _config;
  }
}
