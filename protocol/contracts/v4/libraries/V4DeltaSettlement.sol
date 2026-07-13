// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IPoolManager.sol";
import {BalanceDelta} from "@uniswap/v4-periphery/lib/v4-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-periphery/lib/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolKey.sol";

/// @title ITokenPuller
/// @author Pop Charts
/// @notice Minimal interface for external ERC20 allowance-transfer helpers.
interface ITokenPuller {
  /// @notice Transfers approved ERC20 tokens from an owner to a recipient.
  /// @param from Token owner.
  /// @param to Token recipient.
  /// @param amount Token amount.
  /// @param token ERC20 token address.
  function transferFrom(address from, address to, uint160 amount, address token) external;
}

/// @title V4DeltaSettlement
/// @author Pop Charts
/// @notice Balance-delta settlement plumbing for bounded pool orders: sign
///   validation, taking positive deltas out of the pool, and settling owed
///   currency into the pool through an allowance puller. Stateless — every
///   function operates only on the pool manager, the puller, and its
///   arguments, so order lifecycle state stays with the calling contract.
library V4DeltaSettlement {
  using CurrencyLibrary for Currency;

  /// @notice Reverts when a native-currency pool reaches settlement.
  error NativeCurrencyUnsupported();
  /// @notice Reverts when a settled input exceeds the caller's declared maximum.
  /// @param actual Amount the pool required.
  /// @param maximum Maximum the order owner accepted.
  error AmountExceedsMaximum(uint256 actual, uint256 maximum);
  /// @notice Reverts when a pull amount cannot fit the allowance-transfer type.
  /// @param amount Amount that overflowed uint160.
  error PullAmountTooLarge(uint256 amount);
  /// @notice Reverts when a balance delta has an unexpected sign for the flow.
  /// @param amount0 Currency0 delta observed.
  /// @param amount1 Currency1 delta observed.
  error UnexpectedNegativeDelta(int128 amount0, int128 amount1);

  /// @notice Settles the maker-owed input side of an order-creation delta.
  /// @param poolManager Pool manager being settled against.
  /// @param tokenPuller Allowance helper pulling the owner's tokens.
  /// @param key Pool key for the order's pool.
  /// @param owner Order owner whose tokens are pulled.
  /// @param zeroForOne Whether the maker sells currency0 for currency1.
  /// @param amountInMaximum Maximum input the owner accepted.
  /// @param delta Balance delta produced by adding the order liquidity.
  /// @return amountIn Input amount actually settled.
  function settleOrderInput(
    IPoolManager poolManager,
    ITokenPuller tokenPuller,
    PoolKey memory key,
    address owner,
    bool zeroForOne,
    uint256 amountInMaximum,
    BalanceDelta delta
  ) internal returns (uint256 amountIn) {
    int128 amount0 = delta.amount0();
    int128 amount1 = delta.amount1();
    if (zeroForOne) {
      if (amount0 >= 0 || amount1 != 0) {
        revert UnexpectedNegativeDelta(amount0, amount1);
      }
      amountIn = uint256(uint128(-amount0));
      settle(poolManager, tokenPuller, key.currency0, owner, amountIn);
    } else {
      if (amount1 >= 0 || amount0 != 0) {
        revert UnexpectedNegativeDelta(amount0, amount1);
      }
      amountIn = uint256(uint128(-amount1));
      settle(poolManager, tokenPuller, key.currency1, owner, amountIn);
    }

    if (amountIn > amountInMaximum) {
      revert AmountExceedsMaximum(amountIn, amountInMaximum);
    }
  }

  /// @notice Takes both currencies of a non-negative delta to a recipient.
  /// @param poolManager Pool manager being drawn from.
  /// @param key Pool key for the order's pool.
  /// @param recipient Account receiving the taken currencies.
  /// @param delta Balance delta whose positive amounts are taken.
  /// @return amount0 Currency0 amount taken.
  /// @return amount1 Currency1 amount taken.
  function takePositiveDeltas(
    IPoolManager poolManager,
    PoolKey memory key,
    address recipient,
    BalanceDelta delta
  ) internal returns (uint256 amount0, uint256 amount1) {
    int128 delta0 = delta.amount0();
    int128 delta1 = delta.amount1();
    if (delta0 < 0 || delta1 < 0) {
      revert UnexpectedNegativeDelta(delta0, delta1);
    }

    if (delta0 > 0) {
      amount0 = uint256(uint128(delta0));
      poolManager.take(key.currency0, recipient, amount0);
    }
    if (delta1 > 0) {
      amount1 = uint256(uint128(delta1));
      poolManager.take(key.currency1, recipient, amount1);
    }
  }

  /// @notice Takes the net of a removal and an addition delta to a recipient.
  /// @param poolManager Pool manager being drawn from.
  /// @param key Pool key for the order's pool.
  /// @param recipient Account receiving the taken currencies.
  /// @param removedDelta Delta from removing the original liquidity.
  /// @param addedDelta Delta from adding the remaining partial liquidity.
  /// @return amount0 Currency0 amount taken.
  /// @return amount1 Currency1 amount taken.
  function takePositiveNetDeltas(
    IPoolManager poolManager,
    PoolKey memory key,
    address recipient,
    BalanceDelta removedDelta,
    BalanceDelta addedDelta
  ) internal returns (uint256 amount0, uint256 amount1) {
    int128 delta0 = removedDelta.amount0() + addedDelta.amount0();
    int128 delta1 = removedDelta.amount1() + addedDelta.amount1();
    if (delta0 < 0 || delta1 < 0) {
      revert UnexpectedNegativeDelta(delta0, delta1);
    }

    if (delta0 > 0) {
      amount0 = uint256(uint128(delta0));
      poolManager.take(key.currency0, recipient, amount0);
    }
    if (delta1 > 0) {
      amount1 = uint256(uint128(delta1));
      poolManager.take(key.currency1, recipient, amount1);
    }
  }

  /// @notice Settles owed currency into the pool by pulling the owner's tokens.
  /// @param poolManager Pool manager being settled against.
  /// @param tokenPuller Allowance helper pulling the owner's tokens.
  /// @param currency Currency being settled.
  /// @param owner Account whose tokens are pulled.
  /// @param amount Currency amount to settle.
  function settle(
    IPoolManager poolManager,
    ITokenPuller tokenPuller,
    Currency currency,
    address owner,
    uint256 amount
  ) internal {
    if (currency.isAddressZero()) {
      revert NativeCurrencyUnsupported();
    }
    if (amount > type(uint160).max) {
      revert PullAmountTooLarge(amount);
    }

    poolManager.sync(currency);
    tokenPuller.transferFrom(
      owner,
      address(poolManager),
      uint160(amount),
      Currency.unwrap(currency)
    );
    poolManager.settle();
  }

  /// @notice Requires a fully non-negative delta and returns its currency0 amount.
  /// @param delta Balance delta to read.
  /// @return amount Currency0 amount of the delta.
  function positiveDeltaAmount0(BalanceDelta delta) internal pure returns (uint256 amount) {
    int128 amount0 = delta.amount0();
    int128 amount1 = delta.amount1();
    if (amount0 < 0 || amount1 < 0) {
      revert UnexpectedNegativeDelta(amount0, amount1);
    }

    return uint256(uint128(amount0));
  }

  /// @notice Requires a fully non-negative delta and returns its currency1 amount.
  /// @param delta Balance delta to read.
  /// @return amount Currency1 amount of the delta.
  function positiveDeltaAmount1(BalanceDelta delta) internal pure returns (uint256 amount) {
    int128 amount0 = delta.amount0();
    int128 amount1 = delta.amount1();
    if (amount0 < 0 || amount1 < 0) {
      revert UnexpectedNegativeDelta(amount0, amount1);
    }

    return uint256(uint128(amount1));
  }

  /// @notice Requires a partial-fill re-add delta to owe only the input side.
  /// @param zeroForOne Whether the maker sells currency0 for currency1.
  /// @param delta Balance delta produced by re-adding partial liquidity.
  function validatePartialAddDelta(bool zeroForOne, BalanceDelta delta) internal pure {
    int128 amount0 = delta.amount0();
    int128 amount1 = delta.amount1();
    if (zeroForOne) {
      if (amount0 > 0 || amount1 != 0) {
        revert UnexpectedNegativeDelta(amount0, amount1);
      }
    } else if (amount1 > 0 || amount0 != 0) {
      revert UnexpectedNegativeDelta(amount0, amount1);
    }
  }
}
