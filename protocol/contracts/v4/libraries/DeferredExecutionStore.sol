// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-periphery/lib/v4-core/src/libraries/StateLibrary.sol";
import {PoolId} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolKey.sol";
import {PackedOrderId} from "./PackedOrderId.sol";

/// @title DeferredExecutionStore
/// @author Pop Charts
/// @notice Storage and identity mechanics for deferred crossed-order batches:
///   nonce-scoped execution IDs, batch storage, pending checks, and the
///   resolver-facing target-tick adjustment. Processing the batch — order
///   execution, settlement, and book mutation — stays with the calling
///   contract; this library only records what was deferred.
library DeferredExecutionStore {
  using StateLibrary for IPoolManager;

  /// @notice Deferred crossed-order batch awaiting resolver execution.
  /// @param pending Whether the batch is still waiting for resolver work.
  /// @param key Pool key for the deferred batch.
  /// @param fromTick Pool tick observed before the original movement.
  /// @param toTick Pool tick observed after the original movement.
  /// @param sqrtPriceX96 Pool square-root price after the original movement.
  /// @param nextOrderIndex Next deferred order index to process.
  /// @param orderIds Crossed order IDs not processed in the immediate batch.
  struct DeferredExecution {
    bool pending;
    PoolKey key;
    int24 fromTick;
    int24 toTick;
    uint160 sqrtPriceX96;
    uint256 nextOrderIndex;
    PackedOrderId[] orderIds;
  }

  /// @notice Deferred-execution records addressed by execution ID.
  /// @param executions Deferred batches by execution ID.
  /// @param nonce Monotonic nonce scoping execution IDs to this contract.
  struct Store {
    mapping(bytes32 => DeferredExecution) executions;
    uint256 nonce;
  }

  /// @notice Emitted when crossed orders are deferred for resolver work.
  /// @param executionId Deferred execution ID.
  /// @param poolId Pool containing the deferred orders.
  /// @param fromTick Pool tick before the original movement.
  /// @param toTick Pool tick after the original movement.
  /// @param orderCount Number of order IDs stored for resolver work.
  event DeferredExecutionStored(
    bytes32 indexed executionId,
    PoolId indexed poolId,
    int24 fromTick,
    int24 toTick,
    uint256 orderCount
  );

  function store(
    Store storage self,
    PoolKey memory key,
    PoolId poolId,
    int24 fromTick,
    int24 toTick,
    uint160 sqrtPriceX96,
    PackedOrderId[] memory orderIds,
    uint256 startIndex
  ) internal returns (bytes32 executionId) {
    uint256 orderCount = orderIds.length - startIndex;
    ++self.nonce;
    executionId = _executionId(poolId, fromTick, toTick, sqrtPriceX96, orderCount, self.nonce);

    DeferredExecution storage execution = self.executions[executionId];
    execution.pending = true;
    execution.key = key;
    execution.fromTick = fromTick;
    execution.toTick = toTick;
    execution.sqrtPriceX96 = sqrtPriceX96;
    for (uint256 i = startIndex; i < orderIds.length; ++i) {
      execution.orderIds.push(orderIds[i]);
    }

    emit DeferredExecutionStored(executionId, poolId, fromTick, toTick, orderCount);
  }

  /// @notice Returns a storage pointer to a deferred batch.
  /// @param self Deferred-execution store.
  /// @param executionId Execution ID to read.
  /// @return Deferred batch storage record.
  function at(
    Store storage self,
    bytes32 executionId
  ) internal view returns (DeferredExecution storage) {
    return self.executions[executionId];
  }

  /// @notice Returns whether a deferred batch is still pending.
  /// @param self Deferred-execution store.
  /// @param executionId Execution ID to check.
  /// @return True when the batch awaits resolver work.
  function isPending(Store storage self, bytes32 executionId) internal view returns (bool) {
    return self.executions[executionId].pending;
  }

  /// @notice Deletes a fully processed deferred batch.
  /// @param self Deferred-execution store.
  /// @param executionId Execution ID to remove.
  function remove(Store storage self, bytes32 executionId) internal {
    delete self.executions[executionId];
  }

  function adjustedToTick(
    IPoolManager poolManager,
    PoolId poolId,
    int24 fromTick,
    int24 toTick
  ) internal view returns (int24) {
    (, int24 currentTick, , ) = poolManager.getSlot0(poolId);
    if (toTick > fromTick) {
      return currentTick <= fromTick ? fromTick : currentTick;
    }
    if (toTick < fromTick) {
      return currentTick >= fromTick ? fromTick : currentTick;
    }

    return toTick;
  }

  /// @notice Derives a chain- and contract-scoped deferred execution ID.
  /// @dev Split out of `store` solely to relieve stack pressure (stack-too-deep
  ///   at the encode site once the Store parameter joined the frame); do not
  ///   inline it back.
  function _executionId(
    PoolId poolId,
    int24 fromTick,
    int24 toTick,
    uint160 sqrtPriceX96,
    uint256 orderCount,
    uint256 nonce
  ) private view returns (bytes32) {
    return
      keccak256(
        abi.encode(
          block.chainid,
          address(this),
          poolId,
          fromTick,
          toTick,
          sqrtPriceX96,
          orderCount,
          nonce
        )
      );
  }
}
