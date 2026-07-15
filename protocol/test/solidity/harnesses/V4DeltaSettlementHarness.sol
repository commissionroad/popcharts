// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

import {IHooks} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IPoolManager.sol";
import {
  BalanceDelta,
  toBalanceDelta
} from "@uniswap/v4-periphery/lib/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-periphery/lib/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolKey.sol";
import {
  ITokenPuller,
  V4DeltaSettlement
} from "../../../contracts/v4/libraries/V4DeltaSettlement.sol";

/// @title V4DeltaSettlementHarness
/// @author Pop Charts
/// @notice Exposes internal v4 delta-settlement helpers for Solidity tests.
contract V4DeltaSettlementHarness {
  /// @notice Exposes order-input settlement.
  /// @param poolManager Pool manager address.
  /// @param tokenPuller Allowance helper address.
  /// @param currency0 Pool currency0.
  /// @param currency1 Pool currency1.
  /// @param owner Order owner.
  /// @param zeroForOne Whether the maker sells currency0 for currency1.
  /// @param amountInMaximum Maximum input accepted by the owner.
  /// @param amount0 Currency0 delta.
  /// @param amount1 Currency1 delta.
  /// @return amountIn Amount settled into the pool.
  function settleOrderInput(
    address poolManager,
    address tokenPuller,
    Currency currency0,
    Currency currency1,
    address owner,
    bool zeroForOne,
    uint256 amountInMaximum,
    int128 amount0,
    int128 amount1
  ) external returns (uint256 amountIn) {
    return
      V4DeltaSettlement.settleOrderInput(
        IPoolManager(poolManager),
        ITokenPuller(tokenPuller),
        _poolKey(currency0, currency1),
        owner,
        zeroForOne,
        amountInMaximum,
        toBalanceDelta(amount0, amount1)
      );
  }

  /// @notice Exposes positive-delta withdrawal.
  /// @param poolManager Pool manager address.
  /// @param currency0 Pool currency0.
  /// @param currency1 Pool currency1.
  /// @param recipient Withdrawal recipient.
  /// @param amount0 Currency0 delta.
  /// @param amount1 Currency1 delta.
  /// @return taken0 Currency0 amount taken.
  /// @return taken1 Currency1 amount taken.
  function takePositiveDeltas(
    address poolManager,
    Currency currency0,
    Currency currency1,
    address recipient,
    int128 amount0,
    int128 amount1
  ) external returns (uint256 taken0, uint256 taken1) {
    return
      V4DeltaSettlement.takePositiveDeltas(
        IPoolManager(poolManager),
        _poolKey(currency0, currency1),
        recipient,
        toBalanceDelta(amount0, amount1)
      );
  }

  /// @notice Exposes net positive-delta withdrawal.
  /// @param poolManager Pool manager address.
  /// @param currency0 Pool currency0.
  /// @param currency1 Pool currency1.
  /// @param recipient Withdrawal recipient.
  /// @param removedAmount0 Removed-liquidity currency0 delta.
  /// @param removedAmount1 Removed-liquidity currency1 delta.
  /// @param addedAmount0 Added-liquidity currency0 delta.
  /// @param addedAmount1 Added-liquidity currency1 delta.
  /// @return taken0 Net currency0 amount taken.
  /// @return taken1 Net currency1 amount taken.
  function takePositiveNetDeltas(
    address poolManager,
    Currency currency0,
    Currency currency1,
    address recipient,
    int128 removedAmount0,
    int128 removedAmount1,
    int128 addedAmount0,
    int128 addedAmount1
  ) external returns (uint256 taken0, uint256 taken1) {
    BalanceDelta removedDelta = toBalanceDelta(removedAmount0, removedAmount1);
    BalanceDelta addedDelta = toBalanceDelta(addedAmount0, addedAmount1);
    return
      V4DeltaSettlement.takePositiveNetDeltas(
        IPoolManager(poolManager),
        _poolKey(currency0, currency1),
        recipient,
        removedDelta,
        addedDelta
      );
  }

  /// @notice Exposes direct currency settlement.
  /// @param poolManager Pool manager address.
  /// @param tokenPuller Allowance helper address.
  /// @param currency Currency to settle.
  /// @param owner Token owner.
  /// @param amount Amount to settle.
  function settle(
    address poolManager,
    address tokenPuller,
    Currency currency,
    address owner,
    uint256 amount
  ) external {
    V4DeltaSettlement.settle(
      IPoolManager(poolManager),
      ITokenPuller(tokenPuller),
      currency,
      owner,
      amount
    );
  }

  /// @notice Exposes non-negative currency0 extraction.
  /// @param amount0 Currency0 delta.
  /// @param amount1 Currency1 delta.
  /// @return amount Currency0 amount.
  function positiveDeltaAmount0(
    int128 amount0,
    int128 amount1
  ) external pure returns (uint256 amount) {
    return V4DeltaSettlement.positiveDeltaAmount0(toBalanceDelta(amount0, amount1));
  }

  /// @notice Exposes non-negative currency1 extraction.
  /// @param amount0 Currency0 delta.
  /// @param amount1 Currency1 delta.
  /// @return amount Currency1 amount.
  function positiveDeltaAmount1(
    int128 amount0,
    int128 amount1
  ) external pure returns (uint256 amount) {
    return V4DeltaSettlement.positiveDeltaAmount1(toBalanceDelta(amount0, amount1));
  }

  /// @notice Exposes partial-add delta validation.
  /// @param zeroForOne Whether the maker sells currency0 for currency1.
  /// @param amount0 Currency0 delta.
  /// @param amount1 Currency1 delta.
  function validatePartialAddDelta(bool zeroForOne, int128 amount0, int128 amount1) external pure {
    V4DeltaSettlement.validatePartialAddDelta(zeroForOne, toBalanceDelta(amount0, amount1));
  }

  /// @notice Builds the minimal pool key needed by settlement helpers.
  /// @param currency0 Pool currency0.
  /// @param currency1 Pool currency1.
  /// @return key Pool key carrying the two currencies.
  function _poolKey(
    Currency currency0,
    Currency currency1
  ) private pure returns (PoolKey memory key) {
    return
      PoolKey({
        currency0: currency0,
        currency1: currency1,
        fee: 0,
        tickSpacing: 0,
        hooks: IHooks(address(0))
      });
  }
}
