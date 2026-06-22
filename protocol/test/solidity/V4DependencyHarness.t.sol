// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {ISignatureTransfer} from "permit2/src/interfaces/ISignatureTransfer.sol";
import {V4DependencyHarness} from "./harnesses/V4DependencyHarness.sol";

contract V4DependencyHarnessTest is Test {
  V4DependencyHarness private harness;

  function setUp() public {
    harness = new V4DependencyHarness();
  }

  function test_ImportsV4HookFlags() public view {
    assertEq(harness.plannedHookFlags(), Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
  }

  function test_ImportsPoolKeyAndPoolId() public view {
    PoolId poolId = harness.poolIdFor(address(0x1000), address(0x2000));

    assertTrue(PoolId.unwrap(poolId) != bytes32(0));
  }

  function test_ImportsPoolManagerAndPermit2Interfaces() public view {
    (
      bytes4 poolManagerSelector,
      bytes4 allowanceTransferSelector,
      bytes4 signatureTransferSelector
    ) = harness.importedSelectors();

    assertEq(poolManagerSelector, IPoolManager.CurrencyNotSettled.selector);
    assertEq(allowanceTransferSelector, IAllowanceTransfer.AllowanceExpired.selector);
    assertEq(signatureTransferSelector, ISignatureTransfer.InvalidAmount.selector);
  }

  function test_ImportsV4PeripheryHookMiner() public view {
    address computed = harness.computeHookAddress(
      address(0x4e59b44847b379578588920cA78FbF26c0B4956C),
      42,
      hex"60006000"
    );

    assertTrue(computed != address(0));
  }
}
