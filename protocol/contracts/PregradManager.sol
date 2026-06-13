// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LmsrMath} from "./libraries/LmsrMath.sol";
import {MarketTypes} from "./types/MarketTypes.sol";

/// @title PregradManager
/// @author Pop Charts
/// @notice Singleton manager for all Pop Charts pre-graduation markets.
contract PregradManager {
  error InvalidCollateral();
  error InvalidMetadataHash();
  error InvalidCloseTime();
  error InvalidGraduationThreshold();
  error MarketDoesNotExist(uint256 marketId);

  /// @notice Emitted when a new bootstrap market is created.
  /// @param marketId Canonical pregrad market ID.
  /// @param creator Account that created the market.
  /// @param metadataHash Hash of market metadata and resolution rules.
  /// @param collateral Collateral token accepted by the market.
  /// @param openingProbabilityWad Opening YES probability, scaled by 1e18.
  /// @param liquidityParameter Virtual LMSR smoothness parameter.
  /// @param graduationThreshold Minimum matched market cap required to graduate.
  /// @param closeTime Timestamp after which an ungraduated market can refund.
  event MarketCreated(
    uint256 indexed marketId,
    address indexed creator,
    bytes32 indexed metadataHash,
    address collateral,
    uint256 openingProbabilityWad,
    uint256 liquidityParameter,
    uint256 graduationThreshold,
    uint64 closeTime
  );

  uint256 private _nextMarketId = 1;
  mapping(uint256 marketId => MarketTypes.MarketRecord) private _markets;

  /// @notice Creates a new market in Bootstrap status.
  /// @param params Market creation parameters, excluding creator.
  /// @return marketId Canonical pregrad market ID.
  function createMarket(
    MarketTypes.CreateMarketParams calldata params
  ) external returns (uint256 marketId) {
    _validateCreateMarketParams(params);

    marketId = _nextMarketId;
    ++_nextMarketId;

    MarketTypes.MarketRecord storage market = _markets[marketId];
    market.config = MarketTypes.MarketConfig({
      collateral: params.collateral,
      creator: msg.sender,
      metadataHash: params.metadataHash,
      openingProbabilityWad: params.openingProbabilityWad,
      liquidityParameter: params.liquidityParameter,
      graduationThreshold: params.graduationThreshold,
      closeTime: params.closeTime
    });
    market.state.status = MarketTypes.MarketStatus.Bootstrap;

    emit MarketCreated(
      marketId,
      msg.sender,
      params.metadataHash,
      params.collateral,
      params.openingProbabilityWad,
      params.liquidityParameter,
      params.graduationThreshold,
      params.closeTime
    );
  }

  /// @notice Returns the next market ID that will be assigned.
  function nextMarketId() external view returns (uint256) {
    return _nextMarketId;
  }

  /// @notice Returns the total number of markets created.
  function marketCount() external view returns (uint256) {
    return _nextMarketId - 1;
  }

  /// @notice Returns whether `marketId` exists.
  /// @param marketId Market ID to check.
  function marketExists(uint256 marketId) public view returns (bool) {
    return marketId != 0 && marketId < _nextMarketId;
  }

  /// @notice Returns immutable market configuration.
  /// @param marketId Market ID to read.
  function getMarketConfig(
    uint256 marketId
  ) external view returns (MarketTypes.MarketConfig memory) {
    _requireMarketExists(marketId);
    return _markets[marketId].config;
  }

  /// @notice Returns mutable market lifecycle and accounting state.
  /// @param marketId Market ID to read.
  function getMarketState(uint256 marketId) external view returns (MarketTypes.MarketState memory) {
    _requireMarketExists(marketId);
    return _markets[marketId].state;
  }

  function _validateCreateMarketParams(
    MarketTypes.CreateMarketParams calldata params
  ) private view {
    if (params.collateral == address(0)) {
      revert InvalidCollateral();
    }
    if (params.metadataHash == bytes32(0)) {
      revert InvalidMetadataHash();
    }
    if (params.closeTime <= block.timestamp) {
      revert InvalidCloseTime();
    }
    if (params.graduationThreshold == 0) {
      revert InvalidGraduationThreshold();
    }

    LmsrMath.validateOpeningProbability(params.openingProbabilityWad);
    LmsrMath.validateLiquidityParameter(params.liquidityParameter);
  }

  function _requireMarketExists(uint256 marketId) private view {
    if (!marketExists(marketId)) {
      revert MarketDoesNotExist(marketId);
    }
  }
}
