// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {ISignatureTransfer} from "permit2/src/interfaces/ISignatureTransfer.sol";

/// @title V4DependencyHarness
/// @author Pop Charts
/// @notice Compile-time probe for Uniswap v4 and Permit2 Solidity imports.
contract V4DependencyHarness {
  using PoolIdLibrary for PoolKey;

  /// @notice Returns the first hook permission mask planned for the local smoke.
  /// @return Permission flags for beforeSwap and afterSwap callbacks.
  function plannedHookFlags() external pure returns (uint160) {
    return Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
  }

  /// @notice Computes the pool ID for a minimal sorted pool key.
  /// @param currency0 Lower sorted ERC20 currency address.
  /// @param currency1 Higher sorted ERC20 currency address.
  /// @return poolId v4 pool ID for the supplied key.
  function poolIdFor(address currency0, address currency1) external pure returns (PoolId poolId) {
    PoolKey memory key = PoolKey({
      currency0: Currency.wrap(currency0),
      currency1: Currency.wrap(currency1),
      fee: 3000,
      tickSpacing: 60,
      hooks: IHooks(address(0))
    });

    return key.toId();
  }

  /// @notice Returns representative selectors from imported v4 and Permit2 interfaces.
  /// @return poolManagerSelector Selector from `IPoolManager`.
  /// @return allowanceTransferSelector Selector from Permit2 allowance transfer.
  /// @return signatureTransferSelector Selector from Permit2 signature transfer.
  function importedSelectors()
    external
    pure
    returns (
      bytes4 poolManagerSelector,
      bytes4 allowanceTransferSelector,
      bytes4 signatureTransferSelector
    )
  {
    return (
      IPoolManager.CurrencyNotSettled.selector,
      IAllowanceTransfer.AllowanceExpired.selector,
      ISignatureTransfer.InvalidAmount.selector
    );
  }

  /// @notice Computes a CREATE2 hook address through v4 periphery's HookMiner.
  /// @param deployer CREATE2 deployer address.
  /// @param salt Salt to use for address computation.
  /// @param creationCodeWithArgs Hook creation code plus constructor args.
  /// @return hookAddress Computed hook address.
  function computeHookAddress(
    address deployer,
    uint256 salt,
    bytes calldata creationCodeWithArgs
  ) external pure returns (address hookAddress) {
    return HookMiner.computeAddress(deployer, salt, creationCodeWithArgs);
  }
}
