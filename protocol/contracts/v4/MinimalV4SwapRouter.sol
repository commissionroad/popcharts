// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

import {IERC20Minimal} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/external/IERC20Minimal.sol";
import {IUnlockCallback} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IPoolManager} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IPoolManager.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-periphery/lib/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-periphery/lib/v4-core/src/types/BalanceDelta.sol";
import {PoolKey} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolKey.sol";
import {
  ModifyLiquidityParams,
  SwapParams
} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolOperation.sol";

/// @title MinimalV4SwapRouter
/// @author Pop Charts
/// @notice ERC20-only local smoke router for Uniswap v4 PoolManager interactions.
/// @dev Arc USDC must be passed through its 6-decimal ERC20 interface, not the
/// native gas-balance view or v4 native currency sentinel.
contract MinimalV4SwapRouter is IUnlockCallback {
  using CurrencyLibrary for Currency;

  /// @notice Emitted when the router is asked to settle native currency.
  /// @dev On Arc, use the USDC ERC20 interface instead of native currency.
  error NativeCurrencyUnsupported();

  /// @notice Emitted when an ERC20 transfer used for settlement returns false.
  error ERC20TransferFailed(Currency currency);

  /// @notice Emitted when an unexpected address calls the unlock callback.
  error UnauthorizedUnlockCallback();

  /// @notice Emitted when the unlock action discriminator is unknown.
  error UnsupportedUnlockAction(uint8 action);

  /// @notice Uniswap v4 PoolManager used by this router.
  IPoolManager public immutable POOL_MANAGER;

  enum UnlockAction {
    ModifyLiquidity,
    Swap
  }

  struct ModifyLiquidityCallbackData {
    address payer;
    PoolKey key;
    ModifyLiquidityParams params;
    bytes hookData;
  }

  struct SwapCallbackData {
    address payer;
    address recipient;
    PoolKey key;
    SwapParams params;
    bytes hookData;
  }

  /// @notice Stores the PoolManager used for all local v4 operations.
  /// @param _poolManager Local Uniswap v4 PoolManager.
  constructor(IPoolManager _poolManager) {
    POOL_MANAGER = _poolManager;
  }

  /// @notice Modifies v4 liquidity and settles resulting ERC20 deltas from the caller.
  /// @param key Pool key to modify.
  /// @param params Liquidity modification parameters.
  /// @param hookData Hook data passed through to PoolManager.
  /// @return delta Caller delta returned by PoolManager.
  /// @return feesAccrued Fees accrued returned by PoolManager.
  function modifyLiquidity(
    PoolKey calldata key,
    ModifyLiquidityParams calldata params,
    bytes calldata hookData
  ) external returns (BalanceDelta delta, BalanceDelta feesAccrued) {
    bytes memory result = POOL_MANAGER.unlock(
      abi.encode(
        UnlockAction.ModifyLiquidity,
        abi.encode(
          ModifyLiquidityCallbackData({
            payer: msg.sender,
            key: key,
            params: params,
            hookData: hookData
          })
        )
      )
    );

    return abi.decode(result, (BalanceDelta, BalanceDelta));
  }

  /// @notice Executes a v4 swap and settles resulting ERC20 deltas from the caller.
  /// @param key Pool key to swap against.
  /// @param params Swap parameters.
  /// @param recipient Recipient for positive output deltas.
  /// @param hookData Hook data passed through to PoolManager.
  /// @return delta Swap delta returned by PoolManager.
  function swap(
    PoolKey calldata key,
    SwapParams calldata params,
    address recipient,
    bytes calldata hookData
  ) external returns (BalanceDelta delta) {
    bytes memory result = POOL_MANAGER.unlock(
      abi.encode(
        UnlockAction.Swap,
        abi.encode(
          SwapCallbackData({
            payer: msg.sender,
            recipient: recipient,
            key: key,
            params: params,
            hookData: hookData
          })
        )
      )
    );

    return abi.decode(result, (BalanceDelta));
  }

  /// @inheritdoc IUnlockCallback
  function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
    if (msg.sender != address(POOL_MANAGER)) {
      revert UnauthorizedUnlockCallback();
    }

    (UnlockAction action, bytes memory data) = abi.decode(rawData, (UnlockAction, bytes));

    if (action == UnlockAction.ModifyLiquidity) {
      return _modifyLiquidity(data);
    }

    if (action == UnlockAction.Swap) {
      return _swap(data);
    }

    revert UnsupportedUnlockAction(uint8(action));
  }

  function _modifyLiquidity(bytes memory data) private returns (bytes memory) {
    ModifyLiquidityCallbackData memory callbackData = abi.decode(
      data,
      (ModifyLiquidityCallbackData)
    );

    (BalanceDelta delta, BalanceDelta feesAccrued) = POOL_MANAGER.modifyLiquidity(
      callbackData.key,
      callbackData.params,
      callbackData.hookData
    );

    _resolveDelta(
      callbackData.key.currency0,
      callbackData.payer,
      callbackData.payer,
      delta.amount0()
    );
    _resolveDelta(
      callbackData.key.currency1,
      callbackData.payer,
      callbackData.payer,
      delta.amount1()
    );

    return abi.encode(delta, feesAccrued);
  }

  function _swap(bytes memory data) private returns (bytes memory) {
    SwapCallbackData memory callbackData = abi.decode(data, (SwapCallbackData));

    BalanceDelta delta = POOL_MANAGER.swap(
      callbackData.key,
      callbackData.params,
      callbackData.hookData
    );

    _resolveDelta(
      callbackData.key.currency0,
      callbackData.payer,
      callbackData.recipient,
      delta.amount0()
    );
    _resolveDelta(
      callbackData.key.currency1,
      callbackData.payer,
      callbackData.recipient,
      delta.amount1()
    );

    return abi.encode(delta);
  }

  function _resolveDelta(
    Currency currency,
    address payer,
    address recipient,
    int128 amount
  ) private {
    if (amount < 0) {
      _settle(currency, payer, uint256(uint128(-amount)));
    } else if (amount > 0) {
      POOL_MANAGER.take(currency, recipient, uint256(uint128(amount)));
    }
  }

  function _settle(Currency currency, address payer, uint256 amount) private {
    if (currency.isAddressZero()) {
      revert NativeCurrencyUnsupported();
    }

    POOL_MANAGER.sync(currency);
    bool transferred = IERC20Minimal(Currency.unwrap(currency)).transferFrom(
      payer,
      address(POOL_MANAGER),
      amount
    );
    if (!transferred) {
      revert ERC20TransferFailed(currency);
    }

    POOL_MANAGER.settle();
  }
}
