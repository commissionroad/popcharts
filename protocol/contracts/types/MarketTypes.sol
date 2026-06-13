// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MarketTypes
/// @author Pop Charts
/// @notice Shared type definitions for pre-graduation markets.
library MarketTypes {
  /// @notice Product-facing market lifecycle states.
  enum MarketStatus {
    Bootstrap,
    Graduating,
    Graduated,
    Resolved,
    Refunded
  }

  /// @notice Caller-provided market creation parameters.
  struct CreateMarketParams {
    address collateral;
    bytes32 metadataHash;
    uint256 openingProbabilityWad;
    uint256 liquidityParameter;
    uint256 graduationThreshold;
    uint64 closeTime;
  }

  /// @notice Immutable market configuration stored by each market.
  struct MarketConfig {
    address collateral;
    address creator;
    bytes32 metadataHash;
    uint256 openingProbabilityWad;
    uint256 liquidityParameter;
    uint256 graduationThreshold;
    uint64 closeTime;
  }
}

