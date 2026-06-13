// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MarketTypes
/// @author Pop Charts
/// @notice Shared protocol types for virtual LMSR bootstrap markets.
library MarketTypes {
  /// @notice Binary side for a pre-graduation receipt or post-graduation outcome claim.
  enum Side {
    /// @notice The market's YES outcome.
    Yes,
    /// @notice The market's NO outcome.
    No
  }

  /// @notice Lifecycle status for a market managed by the pregrad singleton.
  enum MarketStatus {
    /// @notice The market accepts locked pre-graduation receipts priced by virtual LMSR.
    Active,
    /// @notice The receipt book is frozen and awaiting clearing result finalization.
    Frozen,
    /// @notice Clearing finalized and matched receipt segments can claim postgrad outcome tokens.
    Graduated,
    /// @notice The market did not graduate and receipt escrow is refundable.
    Refunded,
    /// @notice The postgrad outcome has been resolved.
    Resolved,
    /// @notice The market was cancelled before normal graduation or resolution.
    Cancelled
  }

  /// @notice Immutable creation-time configuration for a pregrad market.
  struct MarketConfig {
    /// @notice ERC20 collateral token escrowed by receipt buyers.
    address collateral;
    /// @notice Account that created the market.
    address creator;
    /// @notice Hash of offchain market metadata, sources, and resolution rules.
    bytes32 metadataHash;
    /// @notice Initial YES probability, scaled by 1e18 and strictly between 0 and 1e18.
    uint256 openingProbabilityWad;
    /// @notice Virtual LMSR smoothness parameter `b`, scaled in collateral units.
    uint256 liquidityParameter;
    /// @notice Minimum matched market cap required before the market can graduate.
    uint256 graduationThreshold;
    /// @notice Unix timestamp by which the market must graduate or become refundable.
    uint64 graduationTime;
    /// @notice Unix timestamp by which the postgrad market should resolve.
    uint64 resolutionTime;
  }

  /// @notice Inputs required to create a market.
  /// @dev The creator is intentionally omitted and derived from `msg.sender`.
  struct CreateMarketParams {
    /// @notice ERC20 collateral token escrowed by receipt buyers.
    address collateral;
    /// @notice Hash of offchain market metadata, sources, and resolution rules.
    bytes32 metadataHash;
    /// @notice Initial YES probability, scaled by 1e18 and strictly between 0 and 1e18.
    uint256 openingProbabilityWad;
    /// @notice Virtual LMSR smoothness parameter `b`, scaled in collateral units.
    uint256 liquidityParameter;
    /// @notice Minimum matched market cap required before the market can graduate.
    uint256 graduationThreshold;
    /// @notice Unix timestamp by which the market must graduate or become refundable.
    uint64 graduationTime;
    /// @notice Unix timestamp by which the postgrad market should resolve.
    uint64 resolutionTime;
  }

  /// @notice Mutable lifecycle and accounting state for a market.
  struct MarketState {
    /// @notice Current lifecycle status.
    MarketStatus status;
    /// @notice Number of receipts created for this market.
    uint256 receiptCount;
    /// @notice Total collateral currently escrowed by active receipts.
    uint256 totalEscrowed;
    /// @notice Unix timestamp when the receipt book was frozen, or zero if not frozen.
    uint64 frozenAt;
  }

  /// @notice Full stored record for a pregrad market.
  struct MarketRecord {
    /// @notice Immutable creation-time market configuration.
    MarketConfig config;
    /// @notice Mutable market lifecycle and accounting state.
    MarketState state;
  }

  /// @notice Stored record for one locked pre-graduation priced intent.
  struct Receipt {
    /// @notice Account that owns the receipt and will claim tokens/refund after clearing.
    address owner;
    /// @notice YES or NO side purchased by the receipt.
    Side side;
    /// @notice Provisional share quantity swept by the receipt.
    uint256 shares;
    /// @notice Collateral paid and escrowed for the receipt's exact path cost.
    uint256 cost;
    /// @notice Lower bound of the LMSR path interval traversed by the receipt.
    int256 rLow;
    /// @notice Upper bound of the LMSR path interval traversed by the receipt.
    int256 rHigh;
    /// @notice Per-market creation sequence used for deterministic indexing and tie-breaks.
    uint64 sequence;
    /// @notice Whether the receipt remains active for future clearing or refund.
    bool active;
  }
}
