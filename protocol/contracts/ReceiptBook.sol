// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReceiptBands} from "./libraries/ReceiptBands.sol";
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

  /// @notice Segment-list overlay for one receipt's live support.
  struct ReceiptSupport {
    /// @notice True once a band has been removed; `segments` is then the
    ///   receipt's live support, including when it is empty. While false the
    ///   live support is the placement interval `[rLow, rHigh]` and nothing
    ///   is stored here.
    bool segmented;
    /// @notice Live-support segments: ascending, disjoint, non-touching,
    ///   positive-width.
    MarketTypes.PathSegment[] segments;
  }

  /// @notice Maximum stored live-support segments per receipt (ADR 0014 P1).
  /// @dev Only the owner can fragment a receipt: a withdrawal (P3) removes a
  ///      band from the owner's own live support, and each interior removal
  ///      adds exactly one segment; opposition never mutates stored segments.
  ///      ADR 0014 §2 measured at most 2 segments organically over 398 random
  ///      books, so 8 is 4x the observed worst case while bounding every
  ///      per-receipt reader: P3 withdrawal-request calldata (two words per
  ///      segment, <= 612 bytes per request), challenge-time segment reads,
  ///      and the clearing sweep's boundary count. At the cap, edge trims and
  ///      full-segment removals still succeed — only a further interior split
  ///      reverts — and a band the cap blocks still refunds in full at
  ///      clearing (whitepaper v0.6 §5), so the cap can delay an early exit
  ///      but never locks principal.
  uint256 public constant MAX_RECEIPT_SEGMENTS = 8;

  uint256 private _nextReceiptId = 1;

  mapping(uint256 receiptId => MarketTypes.Receipt) private _receipts;

  mapping(uint256 receiptId => ReceiptSupport) private _receiptSupport;

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

  /// @notice Returns a receipt's live support as an ordered segment list.
  /// @dev The single place the overlay resolves: until a band is removed the
  ///      receipt stores no segments and its live support is the placement
  ///      interval `[rLow, rHigh]`; afterwards the stored list is
  ///      authoritative — including an empty list for a fully withdrawn
  ///      receipt, which never resurrects the placement interval.
  /// @param receiptId Receipt ID to read.
  /// @return Live-support segments: ascending, disjoint, non-touching.
  function getReceiptSegments(
    uint256 receiptId
  ) external view returns (MarketTypes.PathSegment[] memory) {
    _requireReceiptExists(receiptId);

    ReceiptSupport storage support = _receiptSupport[receiptId];
    if (support.segmented) {
      return support.segments;
    }

    MarketTypes.PathSegment[] memory placementInterval = new MarketTypes.PathSegment[](1);
    placementInterval[0] = _placementSegment(receiptId);
    return placementInterval;
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
  /// @param entryFeePaid Entry fee collected alongside the cost.
  /// @param sequence Per-market receipt sequence number.
  function _insertReceipt(
    uint256 receiptId,
    address owner,
    MarketTypes.PlaceReceiptParams calldata params,
    MarketTypes.ReceiptQuote memory quote,
    uint256 entryFeePaid,
    uint64 sequence
  ) internal {
    _receipts[receiptId] = MarketTypes.Receipt({
      marketId: params.marketId,
      owner: owner,
      side: params.side,
      shares: params.shares,
      cost: quote.cost,
      entryFeePaid: entryFeePaid,
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

  /// @notice Removes the band `[lower, upper]` from a receipt's live support,
  ///   splitting the containing segment when the band is interior.
  /// @dev Unused in P1 by design: the caller is ADR 0014 P3's
  ///      `withdrawReceiptBands` request path, which removes each claimed
  ///      segment from live support at request time. The first removal
  ///      materializes the placement interval into the stored list; a removal
  ///      that empties the list leaves the receipt with genuinely empty live
  ///      support. Reverts with `ReceiptBands.EmptyBand`,
  ///      `ReceiptBands.BandOutsideLiveSupport`, or
  ///      `ReceiptBands.SegmentCapExceeded` (cap `MAX_RECEIPT_SEGMENTS`).
  /// @param receiptId Receipt whose live support loses the band.
  /// @param lower Lower path endpoint of the removed band.
  /// @param upper Upper path endpoint of the removed band.
  function _removeReceiptSupportBand(uint256 receiptId, int256 lower, int256 upper) internal {
    _requireReceiptExists(receiptId);

    ReceiptSupport storage support = _receiptSupport[receiptId];
    if (!support.segmented) {
      support.segmented = true;
      support.segments.push(_placementSegment(receiptId));
    }

    ReceiptBands.removeBand(support.segments, lower, upper, MAX_RECEIPT_SEGMENTS);
  }

  /// @notice Returns the placement interval `[rLow, rHigh]` as a segment —
  ///   the live support of a receipt no band was ever removed from.
  /// @param receiptId Receipt ID to read.
  /// @return Placement-interval segment.
  function _placementSegment(
    uint256 receiptId
  ) private view returns (MarketTypes.PathSegment memory) {
    MarketTypes.Receipt storage receipt = _receipts[receiptId];
    return MarketTypes.PathSegment({rLow: receipt.rLow, rHigh: receipt.rHigh});
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
