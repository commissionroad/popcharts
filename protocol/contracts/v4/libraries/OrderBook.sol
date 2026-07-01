// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

import {PackedOrderId} from "./PackedOrderId.sol";

/// @title OrderBook
/// @author Pop Charts
/// @notice Tick-indexed order storage for one bounded pool.
library OrderBook {
  /// @notice Reverts when no more per-pool order IDs can be allocated.
  error OrderIdOverflow();
  /// @notice Reverts when an order ID is absent from the expected threshold tick.
  /// @param thresholdTick Tick where the order should have been indexed.
  /// @param orderId Missing per-pool order ID.
  error OrderIdNotIndexed(int24 thresholdTick, PackedOrderId orderId);

  /// @notice Per-pool tick-indexed order book.
  /// @param orders Packed order IDs by threshold tick.
  /// @param nextOrderId Next per-pool order ID to allocate.
  struct Book {
    mapping(int24 => PackedOrderId[]) orders;
    uint32 nextOrderId;
  }

  /// @notice Allocates a new nonzero per-pool order ID.
  /// @param self Order book storage.
  /// @return orderId Allocated per-pool order ID.
  function allocateOrderId(Book storage self) internal returns (uint32 orderId) {
    orderId = self.nextOrderId;
    if (orderId == 0) {
      orderId = 1;
    }
    if (orderId == type(uint32).max) {
      revert OrderIdOverflow();
    }

    self.nextOrderId = orderId + 1;
  }

  /// @notice Adds an order ID at a threshold tick.
  /// @param self Order book storage.
  /// @param thresholdTick Tick that fills the order when crossed.
  /// @param orderId Packed order ID to index.
  function insert(Book storage self, int24 thresholdTick, PackedOrderId orderId) internal {
    self.orders[thresholdTick].push(orderId);
  }

  /// @notice Removes an order ID from a threshold tick.
  /// @param self Order book storage.
  /// @param thresholdTick Tick where the order was indexed.
  /// @param orderId Packed order ID to remove.
  function remove(Book storage self, int24 thresholdTick, PackedOrderId orderId) internal {
    PackedOrderId[] storage ordersAtTick = self.orders[thresholdTick];
    uint256 length = ordersAtTick.length;
    for (uint256 i = 0; i < length; ++i) {
      if (PackedOrderId.unwrap(ordersAtTick[i]) == PackedOrderId.unwrap(orderId)) {
        ordersAtTick[i] = ordersAtTick[length - 1];
        ordersAtTick.pop();
        return;
      }
    }

    revert OrderIdNotIndexed(thresholdTick, orderId);
  }

  /// @notice Removes and returns order IDs at threshold ticks crossed by a tick movement.
  /// @param self Order book storage.
  /// @param fromTick Pool tick before movement.
  /// @param toTick Pool tick after movement.
  /// @param tickSpacing Pool tick spacing.
  /// @return crossedOrderIds Packed order IDs removed from crossed ticks.
  function popCrossedOrderIds(
    Book storage self,
    int24 fromTick,
    int24 toTick,
    int24 tickSpacing
  ) internal returns (PackedOrderId[] memory crossedOrderIds) {
    if (fromTick == toTick) {
      return new PackedOrderId[](0);
    }

    uint256 crossedCount = _countCrossedOrderIds(self, fromTick, toTick, tickSpacing);
    crossedOrderIds = new PackedOrderId[](crossedCount);
    if (crossedCount == 0) {
      return crossedOrderIds;
    }

    uint256 cursor;
    bool upward = toTick > fromTick;
    int24 tick =
      upward
        ? _nextCrossedTick(fromTick, tickSpacing)
        : _previousCrossedTick(fromTick, tickSpacing);

    while (_tickInMovement(tick, toTick, upward)) {
      PackedOrderId[] storage ordersAtTick = self.orders[tick];
      while (ordersAtTick.length > 0) {
        crossedOrderIds[cursor] = ordersAtTick[ordersAtTick.length - 1];
        ordersAtTick.pop();
        ++cursor;
      }
      tick = upward ? tick + tickSpacing : tick - tickSpacing;
    }
  }

  function _countCrossedOrderIds(
    Book storage self,
    int24 fromTick,
    int24 toTick,
    int24 tickSpacing
  ) private view returns (uint256 crossedCount) {
    bool upward = toTick > fromTick;
    int24 tick =
      upward
        ? _nextCrossedTick(fromTick, tickSpacing)
        : _previousCrossedTick(fromTick, tickSpacing);

    while (_tickInMovement(tick, toTick, upward)) {
      crossedCount += self.orders[tick].length;
      tick = upward ? tick + tickSpacing : tick - tickSpacing;
    }
  }

  function _tickInMovement(int24 tick, int24 toTick, bool upward) private pure returns (bool) {
    return upward ? tick <= toTick : tick >= toTick;
  }

  function _nextCrossedTick(int24 tick, int24 tickSpacing) private pure returns (int24) {
    return _floorToSpacing(tick, tickSpacing) + tickSpacing;
  }

  function _previousCrossedTick(int24 tick, int24 tickSpacing) private pure returns (int24) {
    int24 floorTick = _floorToSpacing(tick, tickSpacing);
    if (floorTick == tick) {
      return tick - tickSpacing;
    }

    return floorTick;
  }

  function _floorToSpacing(int24 tick, int24 tickSpacing) private pure returns (int24) {
    int256 tickValue = int256(tick);
    int256 spacingValue = int256(tickSpacing);
    int256 quotient = tickValue / spacingValue;
    if (tickValue < 0 && tickValue % spacingValue != 0) {
      --quotient;
    }

    return int24(quotient * spacingValue);
  }
}
