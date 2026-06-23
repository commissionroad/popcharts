// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PoolId} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolId.sol";

/// @title PoolTickBounds
/// @author Pop Charts
/// @notice Owner-configured inclusive tick bounds for local bounded prediction pools.
contract PoolTickBounds is Ownable {
  /// @notice Inclusive lower and upper ticks for one pool.
  /// @param configured Whether bounds have been configured for the pool.
  /// @param lowerTick Lowest allowed pool tick.
  /// @param upperTick Highest allowed pool tick.
  struct TickBounds {
    bool configured;
    int24 lowerTick;
    int24 upperTick;
  }

  /// @notice Reverts when a lower tick is not below its upper tick.
  /// @param lowerTick Proposed lower tick.
  /// @param upperTick Proposed upper tick.
  error InvalidTickBounds(int24 lowerTick, int24 upperTick);
  /// @notice Reverts when a pool has no configured bounds.
  /// @param poolId Pool that lacks bounds.
  error PoolTickBoundsUnset(PoolId poolId);
  /// @notice Reverts when a pool tick is outside its inclusive bounds.
  /// @param poolId Pool whose tick was validated.
  /// @param tick Observed pool tick.
  /// @param lowerTick Lowest allowed pool tick.
  /// @param upperTick Highest allowed pool tick.
  error PoolTickOutOfBounds(PoolId poolId, int24 tick, int24 lowerTick, int24 upperTick);

  /// @notice Emitted when a pool's inclusive tick bounds are configured.
  /// @param poolId Pool whose bounds changed.
  /// @param lowerTick Lowest allowed pool tick.
  /// @param upperTick Highest allowed pool tick.
  event PoolTickBoundsSet(PoolId indexed poolId, int24 lowerTick, int24 upperTick);

  mapping(PoolId => TickBounds) private _poolTickBounds;

  /// @notice Records the operational owner that may configure pool bounds.
  /// @param owner_ Account that may set pool tick bounds.
  constructor(address owner_) Ownable(owner_) {}

  /// @notice Configures inclusive tick bounds for a pool.
  /// @param poolId Pool that will be bounded.
  /// @param lowerTick Lowest allowed pool tick.
  /// @param upperTick Highest allowed pool tick.
  function setPoolTickBounds(PoolId poolId, int24 lowerTick, int24 upperTick) external onlyOwner {
    if (lowerTick >= upperTick) {
      revert InvalidTickBounds(lowerTick, upperTick);
    }

    _poolTickBounds[poolId] = TickBounds({
      configured: true,
      lowerTick: lowerTick,
      upperTick: upperTick
    });
    emit PoolTickBoundsSet(poolId, lowerTick, upperTick);
  }

  /// @notice Returns the configured inclusive tick bounds for a pool.
  /// @param poolId Pool to inspect.
  /// @return configured Whether bounds have been configured.
  /// @return lowerTick Lowest allowed pool tick.
  /// @return upperTick Highest allowed pool tick.
  function getPoolTickBounds(
    PoolId poolId
  ) external view returns (bool configured, int24 lowerTick, int24 upperTick) {
    TickBounds memory bounds = _poolTickBounds[poolId];
    return (bounds.configured, bounds.lowerTick, bounds.upperTick);
  }

  /// @notice Reverts unless the supplied tick is inside the pool's configured inclusive bounds.
  /// @param poolId Pool being validated.
  /// @param tick Observed pool tick.
  function validatePoolTick(PoolId poolId, int24 tick) external view {
    TickBounds memory bounds = _poolTickBounds[poolId];
    if (!bounds.configured) {
      revert PoolTickBoundsUnset(poolId);
    }

    if (tick < bounds.lowerTick || tick > bounds.upperTick) {
      revert PoolTickOutOfBounds(poolId, tick, bounds.lowerTick, bounds.upperTick);
    }
  }
}
