// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolKey.sol";

/// @title IBoundedPoolOrderManager
/// @author Pop Charts
/// @notice Hook-facing interface for executing crossed bounded-pool orders.
interface IBoundedPoolOrderManager {
  /// @notice Executes any orders crossed by a pool tick movement.
  /// @param key Pool whose tick moved.
  /// @param fromTick Pool tick observed before the swap.
  /// @param toTick Pool tick observed after the swap.
  /// @param sqrtPriceX96 Pool square-root price after the swap.
  function movePoolTick(
    PoolKey calldata key,
    int24 fromTick,
    int24 toTick,
    uint160 sqrtPriceX96
  ) external;
}
