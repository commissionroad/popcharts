// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarketTypes} from "./types/MarketTypes.sol";

/// @title ReceiptBook
/// @author Pop Charts
/// @notice Receipt-side mechanics for pre-graduation receipts: canonical ID
///   allocation, receipt storage and lookups, existence/liveness guards, and
///   per-market sequence math. Market-state effects of placing a receipt
///   (escrow totals, LMSR path, share tallies) stay with the inheriting
///   contract — the book records receipts; it does not price or settle them.
abstract contract ReceiptBook {
  /// @notice Reverts when a receipt-scoped operation references an unknown receipt.
  /// @param receiptId Receipt ID that does not exist.
  error ReceiptDoesNotExist(uint256 receiptId);
  /// @notice Reverts when a receipt is placed or quoted with zero shares.
  error InvalidShares();
  /// @notice Reverts when the per-market receipt sequence cannot fit in uint64.
  /// @param receiptCount Receipt count that would overflow the stored sequence type.
  error ReceiptCountOverflow(uint256 receiptCount);
  /// @notice Reverts when a receipt has already been settled.
  /// @param receiptId Receipt that is no longer active.
  error ReceiptAlreadyClaimed(uint256 receiptId);

  /// @notice Emitted when a locked pre-graduation receipt is placed.
  /// @param receiptId Canonical receipt ID.
  /// @param marketId Market that owns the receipt.
  /// @param owner Account that owns the receipt.
  /// @param side YES or NO side purchased by the receipt.
  /// @param shares Provisional share quantity swept by the receipt.
  /// @param cost Collateral transferred into escrow for the receipt.
  /// @param rLow Lower bound of the LMSR path interval traversed by the receipt.
  /// @param rHigh Upper bound of the LMSR path interval traversed by the receipt.
  /// @param sequence Per-market receipt sequence.
  event ReceiptPlaced(
    uint256 indexed receiptId,
    uint256 indexed marketId,
    address indexed owner,
    MarketTypes.Side side,
    uint256 shares,
    uint256 cost,
    int256 rLow,
    int256 rHigh,
    uint64 sequence
  );

  uint256 private _nextReceiptId = 1;

  mapping(uint256 receiptId => MarketTypes.Receipt) private _receipts;

  /// @notice Returns the next receipt ID that will be assigned.
  /// @return Next receipt ID.
  function nextReceiptId() external view returns (uint256) {
    return _nextReceiptId;
  }

  /// @notice Returns the total number of receipts ever placed.
  /// @return Count of assigned receipt IDs.
  function totalReceiptCount() external view returns (uint256) {
    return _nextReceiptId - 1;
  }

  /// @notice Returns whether a receipt ID has been assigned.
  /// @param receiptId Receipt ID to check.
  /// @return True when the receipt exists.
  function receiptExists(uint256 receiptId) public view returns (bool) {
    return receiptId != 0 && receiptId < _nextReceiptId;
  }

  /// @notice Returns a receipt by ID.
  /// @param receiptId Receipt ID to read.
  /// @return Stored receipt.
  function getReceipt(uint256 receiptId) external view returns (MarketTypes.Receipt memory) {
    _requireReceiptExists(receiptId);
    return _receipts[receiptId];
  }

  /// @notice Assigns and returns the next canonical receipt ID.
  /// @return receiptId Newly allocated receipt ID.
  function _allocateReceiptId() internal returns (uint256 receiptId) {
    receiptId = _nextReceiptId;
    ++_nextReceiptId;
  }

  /// @notice Writes a receipt record; the caller applies market-state effects.
  /// @param receiptId Canonical receipt ID from `_allocateReceiptId`.
  /// @param owner Account that placed the receipt.
  /// @param params Receipt placement parameters.
  /// @param quote Locked LMSR quote backing the receipt.
  /// @param sequence Per-market receipt sequence number.
  function _insertReceipt(
    uint256 receiptId,
    address owner,
    MarketTypes.PlaceReceiptParams calldata params,
    MarketTypes.ReceiptQuote memory quote,
    uint64 sequence
  ) internal {
    _receipts[receiptId] = MarketTypes.Receipt({
      marketId: params.marketId,
      owner: owner,
      side: params.side,
      shares: params.shares,
      cost: quote.cost,
      rLow: quote.rLow,
      rHigh: quote.rHigh,
      sequence: sequence,
      active: true
    });
  }

  /// @notice Returns a storage pointer to a receipt for settlement flows.
  /// @param receiptId Receipt ID to read.
  /// @return Receipt storage record.
  function _receiptAt(uint256 receiptId) internal view returns (MarketTypes.Receipt storage) {
    return _receipts[receiptId];
  }

  /// @notice Requires a receipt ID to have been assigned.
  /// @param receiptId Receipt ID to check.
  function _requireReceiptExists(uint256 receiptId) internal view {
    if (!receiptExists(receiptId)) {
      revert ReceiptDoesNotExist(receiptId);
    }
  }

  /// @notice Requires a receipt to still be unsettled.
  /// @param receiptId Receipt ID to check.
  /// @param receipt Receipt storage record being guarded.
  function _requireActiveReceipt(
    uint256 receiptId,
    MarketTypes.Receipt storage receipt
  ) internal view {
    if (!receipt.active) {
      revert ReceiptAlreadyClaimed(receiptId);
    }
  }

  /// @notice Validates that a receipt quote or placement has nonzero shares.
  /// @param shares Provisional share quantity to validate.
  function _validateReceiptShares(uint256 shares) internal pure {
    if (shares == 0) {
      revert InvalidShares();
    }
  }

  /// @notice Computes the next uint64 per-market receipt sequence.
  /// @param receiptCount Current per-market receipt count.
  /// @return Next per-market receipt sequence.
  function _nextReceiptSequence(uint256 receiptCount) internal pure returns (uint64) {
    uint256 nextSequence = receiptCount + 1;
    if (nextSequence > type(uint64).max) {
      revert ReceiptCountOverflow(nextSequence);
    }

    return uint64(nextSequence);
  }
}
