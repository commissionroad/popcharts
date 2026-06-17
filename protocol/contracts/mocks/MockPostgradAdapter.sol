// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPostgradAdapter} from "../interfaces/IPostgradAdapter.sol";
import {MarketTypes} from "../types/MarketTypes.sol";

/// @title MockPostgradAdapter
/// @author Pop Charts
/// @notice Test adapter that records post-graduation outcome balances.
contract MockPostgradAdapter is IPostgradAdapter {
  /// @notice Reverts when a market is prepared more than once.
  /// @param marketId Market that was already prepared.
  error MarketAlreadyPrepared(uint256 marketId);
  /// @notice Reverts when outcome distribution is attempted before preparation.
  /// @param marketId Market that has not been prepared.
  error MarketNotPrepared(uint256 marketId);

  /// @notice Prepared postgrad market metadata recorded by the mock adapter.
  struct PreparedMarket {
    /// @notice ERC20 collateral token backing complete sets.
    address collateral;
    /// @notice Hash of market metadata and resolution rules.
    bytes32 metadataHash;
    /// @notice Number of complete sets backed by retained collateral.
    uint256 completeSetCount;
    /// @notice Whether the market was prepared.
    bool prepared;
  }

  /// @notice Emitted when retained collateral is handed to the postgrad adapter.
  /// @param marketId Pregrad market ID being prepared.
  /// @param collateral ERC20 collateral token backing complete sets.
  /// @param metadataHash Hash of market metadata and resolution rules.
  /// @param completeSetCount Number of complete sets backed by retained collateral.
  event MockPostgradMarketPrepared(
    uint256 indexed marketId,
    address indexed collateral,
    bytes32 indexed metadataHash,
    uint256 completeSetCount
  );

  /// @notice Emitted when retained outcome tokens are assigned to a user.
  /// @param marketId Pregrad market ID whose outcome is distributed.
  /// @param recipient Account receiving outcome balance.
  /// @param side YES or NO outcome side.
  /// @param amount Outcome token amount distributed.
  event MockOutcomeDistributed(
    uint256 indexed marketId,
    address indexed recipient,
    MarketTypes.Side indexed side,
    uint256 amount
  );

  mapping(uint256 marketId => PreparedMarket) private _preparedMarkets;
  mapping(uint256 marketId => mapping(address account => mapping(MarketTypes.Side side => uint256)))
    private _outcomeBalances;

  /// @inheritdoc IPostgradAdapter
  function prepareMarket(
    uint256 marketId,
    address collateral,
    bytes32 metadataHash,
    uint256 completeSetCount
  ) external {
    if (_preparedMarkets[marketId].prepared) {
      revert MarketAlreadyPrepared(marketId);
    }

    _preparedMarkets[marketId] = PreparedMarket({
      collateral: collateral,
      metadataHash: metadataHash,
      completeSetCount: completeSetCount,
      prepared: true
    });

    emit MockPostgradMarketPrepared(marketId, collateral, metadataHash, completeSetCount);
  }

  /// @inheritdoc IPostgradAdapter
  function distributeOutcome(
    uint256 marketId,
    address recipient,
    MarketTypes.Side side,
    uint256 amount
  ) external {
    if (!_preparedMarkets[marketId].prepared) {
      revert MarketNotPrepared(marketId);
    }

    _outcomeBalances[marketId][recipient][side] += amount;
    emit MockOutcomeDistributed(marketId, recipient, side, amount);
  }

  /// @notice Returns prepared market metadata.
  /// @param marketId Market ID to read.
  /// @return Prepared market record.
  function getPreparedMarket(uint256 marketId) external view returns (PreparedMarket memory) {
    return _preparedMarkets[marketId];
  }

  /// @notice Returns a mock postgrad outcome balance.
  /// @param marketId Market whose outcome balance is queried.
  /// @param account Account whose balance is queried.
  /// @param side YES or NO outcome side.
  /// @return Recorded outcome balance.
  function outcomeBalanceOf(
    uint256 marketId,
    address account,
    MarketTypes.Side side
  ) external view returns (uint256) {
    return _outcomeBalances[marketId][account][side];
  }
}
