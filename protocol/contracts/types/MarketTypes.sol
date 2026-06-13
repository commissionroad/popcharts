// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MarketTypes
/// @author Pop Charts
/// @notice Shared protocol types for virtual LMSR bootstrap markets.
library MarketTypes {
  enum Side {
    Yes,
    No
  }

  enum MarketStatus {
    Bootstrap,
    Frozen,
    Graduated,
    Refunded,
    Resolved,
    Cancelled
  }

  struct MarketConfig {
    address collateral;
    address creator;
    bytes32 metadataHash;
    uint256 openingProbabilityWad;
    uint256 liquidityParameter;
    uint256 graduationThreshold;
    uint64 closeTime;
  }

  struct CreateMarketParams {
    address collateral;
    bytes32 metadataHash;
    uint256 openingProbabilityWad;
    uint256 liquidityParameter;
    uint256 graduationThreshold;
    uint64 closeTime;
  }

  struct MarketState {
    MarketStatus status;
    uint256 receiptCount;
    uint256 totalEscrowed;
    uint64 frozenAt;
  }

  struct MarketRecord {
    MarketConfig config;
    MarketState state;
  }

  struct Receipt {
    address owner;
    Side side;
    uint256 shares;
    uint256 cost;
    int256 rLow;
    int256 rHigh;
    uint64 sequence;
    bool active;
  }
}
