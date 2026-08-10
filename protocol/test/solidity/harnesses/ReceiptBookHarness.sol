// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReceiptBook} from "../../../contracts/ReceiptBook.sol";
import {MarketTypes} from "../../../contracts/types/MarketTypes.sol";

/// @title ReceiptBookHarness
/// @author Pop Charts
/// @notice Exposes internal ReceiptBook receipt-support mechanics for
///   Solidity tests: receipt insertion without market-state effects, and the
///   live-support band removal reserved for ADR 0014 P3.
contract ReceiptBookHarness is ReceiptBook {
  /// @notice Allocates a receipt ID and writes the receipt record.
  /// @param params Receipt placement parameters.
  /// @param quote Locked LMSR quote backing the receipt.
  /// @return receiptId Newly allocated receipt ID.
  function place(
    MarketTypes.PlaceReceiptParams calldata params,
    MarketTypes.ReceiptQuote calldata quote
  ) external returns (uint256 receiptId) {
    receiptId = _allocateReceiptId();
    _insertReceipt(receiptId, msg.sender, params, quote, 0, _nextReceiptSequence(receiptId - 1));
  }

  /// @notice Exposes live-support band removal.
  /// @param receiptId Receipt whose live support loses the band.
  /// @param lower Lower path endpoint of the removed band.
  /// @param upper Upper path endpoint of the removed band.
  function removeSupportBand(uint256 receiptId, int256 lower, int256 upper) external {
    _removeReceiptSupportBand(receiptId, lower, upper);
  }

  /// @notice Exposes live-support band restoration.
  /// @param receiptId Receipt whose live support regains the band.
  /// @param lower Lower path endpoint of the restored band.
  /// @param upper Upper path endpoint of the restored band.
  function restoreSupportBand(uint256 receiptId, int256 lower, int256 upper) external {
    _restoreReceiptSupportBand(receiptId, lower, upper);
  }
}
