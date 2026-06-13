// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PregradMarket} from "./PregradMarket.sol";
import {MarketTypes} from "./types/MarketTypes.sol";

/// @title PopChartsFactory
/// @author Pop Charts
/// @notice Deploys and indexes Pop Charts pre-graduation markets.
contract PopChartsFactory {
  /// @notice Emitted when a new bootstrap market is deployed.
  /// @param market Deployed market address.
  /// @param creator Account that created the market.
  /// @param metadataHash Hash of market metadata and resolution rules.
  /// @param collateral Collateral token accepted by the market.
  event MarketCreated(
    address indexed market,
    address indexed creator,
    bytes32 indexed metadataHash,
    address collateral
  );

  address[] private _markets;

  /// @notice Deploys a market for the caller.
  /// @param params Market creation parameters, excluding creator.
  /// @return market Deployed market address.
  function createMarket(
    MarketTypes.CreateMarketParams calldata params
  ) external returns (address market) {
    MarketTypes.MarketConfig memory config = MarketTypes.MarketConfig({
      collateral: params.collateral,
      creator: msg.sender,
      metadataHash: params.metadataHash,
      openingProbabilityWad: params.openingProbabilityWad,
      liquidityParameter: params.liquidityParameter,
      graduationThreshold: params.graduationThreshold,
      closeTime: params.closeTime
    });

    market = address(new PregradMarket(config));
    _markets.push(market);

    emit MarketCreated(market, msg.sender, params.metadataHash, params.collateral);
  }

  /// @notice Returns the total number of markets deployed by this factory.
  function marketCount() external view returns (uint256) {
    return _markets.length;
  }

  /// @notice Returns the market address at `index`.
  /// @param index Position in the factory's market list.
  function marketAt(uint256 index) external view returns (address) {
    return _markets[index];
  }
}
