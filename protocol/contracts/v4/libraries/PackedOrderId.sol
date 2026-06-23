// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

/// @notice Packed per-pool order identifier stored in tick-indexed order books.
type PackedOrderId is uint32;

/// @title PackedOrderIdLibrary
/// @author Pop Charts
/// @notice Helpers for packing and unpacking per-pool order IDs.
library PackedOrderIdLibrary {
  /// @notice Reverts when an order ID is zero.
  error InvalidOrderId();

  /// @notice Packs a nonzero order ID for order-book storage.
  /// @param orderId Per-pool order ID.
  /// @return packed Packed order ID.
  function pack(uint32 orderId) internal pure returns (PackedOrderId packed) {
    if (orderId == 0) {
      revert InvalidOrderId();
    }

    return PackedOrderId.wrap(orderId);
  }

  /// @notice Unpacks a per-pool order ID.
  /// @param packed Packed order ID.
  /// @return orderId Per-pool order ID.
  function unpack(PackedOrderId packed) internal pure returns (uint32 orderId) {
    return PackedOrderId.unwrap(packed);
  }
}
