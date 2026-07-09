// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarketTypes} from "../types/MarketTypes.sol";

/// @title IPostgradAdapter
/// @author Pop Charts
/// @notice Adapter boundary for finalized pregrad settlements and postgrad outcome markets.
interface IPostgradAdapter {
  /// @notice Prepares a postgrad market backed by retained pregrad collateral.
  /// @param marketId Pregrad market ID being handed off.
  /// @param collateral ERC20 collateral token retained for complete sets.
  /// @param metadataHash Hash of market metadata and resolution rules.
  /// @param retainedCollateral Collateral amount retained for the postgrad market.
  /// @param completeSetCount Outcome-token capacity represented by retained collateral.
  /// @param earliestResolutionTime Earliest timestamp the postgrad market may be
  ///   resolved on-chain (the pregrad market's yesNotBefore gate).
  /// @return postgradMarket Address of the prepared postgrad market.
  /// @return outcomeCapacity Outcome-token capacity actually funded in the prepared
  ///   market. Callers must not trust preparation silently: PregradManager reverts
  ///   graduation unless this equals the clearing root's completeSetCount.
  function prepareMarket(
    uint256 marketId,
    address collateral,
    bytes32 metadataHash,
    uint256 retainedCollateral,
    uint256 completeSetCount,
    uint64 earliestResolutionTime
  ) external returns (address postgradMarket, uint256 outcomeCapacity);

  /// @notice Mints retained postgrad outcome tokens to a finalized receipt owner.
  /// @param marketId Pregrad market ID whose finalized claim is being distributed.
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
