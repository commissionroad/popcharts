// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarketTypes} from "../types/MarketTypes.sol";

/// @title IPostgradAdapter
/// @author Pop Charts
/// @notice Adapter boundary for post-graduation fixed-payout outcome markets.
interface IPostgradAdapter {
  /// @notice Prepares a post-graduation market backed by retained collateral.
  /// @param marketId Pregrad market ID being handed off.
  /// @param collateral ERC20 collateral token retained for complete sets.
  /// @param metadataHash Hash of market metadata and resolution rules.
  /// @param completeSetCount Number of complete YES/NO sets backed by retained collateral.
  function prepareMarket(
    uint256 marketId,
    address collateral,
    bytes32 metadataHash,
    uint256 completeSetCount
  ) external;

  /// @notice Assigns retained post-graduation outcome tokens to a receipt owner.
  /// @param marketId Pregrad market ID whose finalized claims are being distributed.
  /// @param recipient Account receiving outcome tokens.
  /// @param side YES or NO outcome token side.
  /// @param amount Outcome token amount to distribute.
  function distributeOutcome(
    uint256 marketId,
    address recipient,
    MarketTypes.Side side,
    uint256 amount
  ) external;
}
