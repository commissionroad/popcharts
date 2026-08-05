// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

// solhint-disable immutable-vars-naming

import {Hooks} from "@uniswap/v4-periphery/lib/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-periphery/lib/v4-core/src/libraries/StateLibrary.sol";
import {IHooks} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IPoolManager.sol";
import {BalanceDelta} from "@uniswap/v4-periphery/lib/v4-core/src/types/BalanceDelta.sol";
import {
  BeforeSwapDelta,
  BeforeSwapDeltaLibrary
} from "@uniswap/v4-periphery/lib/v4-core/src/types/BeforeSwapDelta.sol";
import {PoolId} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolOperation.sol";
import {IBoundedPoolOrderManager} from "./interfaces/IBoundedPoolOrderManager.sol";
import {PoolTickBounds} from "./PoolTickBounds.sol";

/// @title BoundedPredictionHook
/// @author Pop Charts
/// @notice Minimal hook skeleton that records swap ticks and enforces configured pool tick bounds.
contract BoundedPredictionHook {
  using StateLibrary for IPoolManager;

  /// @notice Last before/after swap ticks observed for one pool.
  /// @param observed Whether the hook has observed at least one swap for the pool.
  /// @param beforeTick Pool tick observed before the most recent swap.
  /// @param afterTick Pool tick observed after the most recent swap.
  /// @param sequence Count of swaps observed for the pool; the last assigned per-pool ordinal.
  /// @dev All four fields pack into one 32-byte slot (1 + 3 + 3 + 8 = 15 bytes), and the
  ///      slot is already written by every swap, so carrying the sequence costs an
  ///      increment rather than an extra storage write (repo ADR 0025).
  struct SwapTickObservation {
    bool observed;
    int24 beforeTick;
    int24 afterTick;
    uint64 sequence;
  }

  /// @notice Reverts when the pool manager address is zero.
  error InvalidPoolManager();
  /// @notice Reverts when the tick-bounds contract address is zero.
  error InvalidPoolTickBounds();
  /// @notice Reverts when a hook callback is called by any address other than the pool manager.
  /// @param caller Unauthorized caller.
  error UnauthorizedPoolManager(address caller);

  /// @notice Emitted with the pool tick observed before a swap.
  /// @param poolId Pool being swapped.
  /// @param tick Pool tick before the swap.
  event BeforeSwapTickObserved(PoolId indexed poolId, int24 tick);
  /// @notice Emitted with the pool tick observed after a swap.
  /// @param poolId Pool being swapped.
  /// @param tick Pool tick after the swap.
  /// @param sequence Per-pool swap ordinal, starting at 1 and contiguous in chain order.
  /// @dev The sequence lets an off-chain consumer detect a missed swap the same way the
  ///      pregrad receipt sequence does: it is assigned by consensus, outside any delivery
  ///      pipeline, so a gap in received ordinals proves a gap in delivery (repo ADR 0025).
  event AfterSwapTickObserved(PoolId indexed poolId, int24 tick, uint64 sequence);

  /// @notice Pool manager allowed to invoke hook callbacks.
  IPoolManager public immutable poolManager;
  /// @notice Configured inclusive tick bounds for pools served by this hook.
  PoolTickBounds public immutable poolTickBounds;
  /// @notice Optional order manager notified after successful swaps.
  IBoundedPoolOrderManager public immutable poolOrderManager;

  mapping(PoolId => SwapTickObservation) private _lastSwapTickObservation;

  /// @notice Records hook dependencies and validates that the deployment address carries the expected flags.
  /// @param poolManager_ Pool manager that will call the hook.
  /// @param poolTickBounds_ Tick-bound validator called before and after swaps.
  /// @param poolOrderManager_ Optional order manager notified after swaps.
  constructor(
    IPoolManager poolManager_,
    PoolTickBounds poolTickBounds_,
    IBoundedPoolOrderManager poolOrderManager_
  ) {
    if (address(poolManager_) == address(0)) {
      revert InvalidPoolManager();
    }
    if (address(poolTickBounds_) == address(0)) {
      revert InvalidPoolTickBounds();
    }

    poolManager = poolManager_;
    poolTickBounds = poolTickBounds_;
    poolOrderManager = poolOrderManager_;

    Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
  }

  /// @notice Returns the hook permission mask used for address mining.
  /// @return flags Permission flags for beforeSwap and afterSwap callbacks.
  function hookPermissionFlags() public pure returns (uint160 flags) {
    return Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
  }

  /// @notice Returns the hook permissions encoded by the deployment address.
  /// @return permissions Enabled hook callbacks.
  function getHookPermissions() public pure returns (Hooks.Permissions memory permissions) {
    return
      Hooks.Permissions({
        beforeInitialize: false,
        afterInitialize: false,
        beforeAddLiquidity: false,
        afterAddLiquidity: false,
        beforeRemoveLiquidity: false,
        afterRemoveLiquidity: false,
        beforeSwap: true,
        afterSwap: true,
        beforeDonate: false,
        afterDonate: false,
        beforeSwapReturnDelta: false,
        afterSwapReturnDelta: false,
        afterAddLiquidityReturnDelta: false,
        afterRemoveLiquidityReturnDelta: false
      });
  }

  /// @notice Returns the last before/after swap ticks observed for a pool.
  /// @param poolId Pool to inspect.
  /// @return observed Whether the hook has observed at least one swap for the pool.
  /// @return beforeTick Pool tick observed before the most recent swap.
  /// @return afterTick Pool tick observed after the most recent swap.
  /// @return sequence Per-pool ordinal of the most recent completed swap (0 before any).
  function lastSwapTickObservation(
    PoolId poolId
  ) external view returns (bool observed, int24 beforeTick, int24 afterTick, uint64 sequence) {
    SwapTickObservation memory observation = _lastSwapTickObservation[poolId];
    return (
      observation.observed,
      observation.beforeTick,
      observation.afterTick,
      observation.sequence
    );
  }

  /// @notice Records and validates the current pool tick before a swap.
  /// @param key Pool being swapped.
  /// @return selector beforeSwap selector required by the pool manager.
  /// @return hookDelta Zero delta because this phase does not collect hook fees.
  /// @return lpFeeOverride Zero because this phase does not override pool fees.
  function beforeSwap(
    address,
    PoolKey calldata key,
    SwapParams calldata,
    bytes calldata
  )
    external
    onlyPoolManager
    returns (bytes4 selector, BeforeSwapDelta hookDelta, uint24 lpFeeOverride)
  {
    PoolId poolId = key.toId();
    int24 tick = _currentTick(poolId);
    poolTickBounds.validatePoolTick(poolId, tick);

    SwapTickObservation storage observation = _lastSwapTickObservation[poolId];
    observation.observed = true;
    observation.beforeTick = tick;

    emit BeforeSwapTickObserved(poolId, tick);
    return (BoundedPredictionHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
  }

  /// @notice Records and validates the current pool tick after a swap.
  /// @param key Pool being swapped.
  /// @return selector afterSwap selector required by the pool manager.
  /// @return hookDelta Zero delta because this phase does not collect hook fees.
  function afterSwap(
    address,
    PoolKey calldata key,
    SwapParams calldata,
    BalanceDelta,
    bytes calldata
  ) external onlyPoolManager returns (bytes4 selector, int128 hookDelta) {
    PoolId poolId = key.toId();
    (uint160 sqrtPriceX96, int24 tick) = _currentSlot(poolId);

    SwapTickObservation storage observation = _lastSwapTickObservation[poolId];
    // The slot is already being written for the tick fields, so the ordinal rides along
    // in the same SSTORE. A swap that later reverts (out-of-bounds tick below) rolls the
    // increment back with everything else, so sequences stay contiguous over *successful*
    // swaps — the property off-chain gap detection relies on (repo ADR 0025).
    uint64 sequence = observation.sequence + 1;
    observation.observed = true;
    observation.afterTick = tick;
    observation.sequence = sequence;

    emit AfterSwapTickObserved(poolId, tick, sequence);
    poolTickBounds.validatePoolTick(poolId, tick);
    if (address(poolOrderManager) != address(0)) {
      poolOrderManager.movePoolTick(key, observation.beforeTick, tick, sqrtPriceX96);
    }

    return (BoundedPredictionHook.afterSwap.selector, 0);
  }

  /// @notice Restricts hook callbacks to the configured pool manager.
  modifier onlyPoolManager() {
    if (msg.sender != address(poolManager)) {
      revert UnauthorizedPoolManager(msg.sender);
    }
    _;
  }

  function _currentTick(PoolId poolId) private view returns (int24 tick) {
    (, tick, , ) = poolManager.getSlot0(poolId);
  }

  function _currentSlot(PoolId poolId) private view returns (uint160 sqrtPriceX96, int24 tick) {
    (sqrtPriceX96, tick, , ) = poolManager.getSlot0(poolId);
  }
}
