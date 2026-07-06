// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {ClearingMathHarness} from "./harnesses/ClearingMathHarness.sol";

contract ClearingMathTest is Test {
  ClearingMathHarness private harness;

  function setUp() public {
    harness = new ClearingMathHarness();
  }

  function test_MinReturnsSmallerValueInEitherOrder() public view {
    assertEq(harness.min(3, 7), 3);
    assertEq(harness.min(7, 3), 3);
    assertEq(harness.min(0, type(uint256).max), 0);
  }

  function test_MinOfEqualValuesReturnsThatValue() public view {
    assertEq(harness.min(42, 42), 42);
    assertEq(harness.min(0, 0), 0);
  }

  function testFuzz_MinNeverExceedsEitherArgument(uint256 left, uint256 right) public view {
    uint256 smaller = harness.min(left, right);

    assertLe(smaller, left);
    assertLe(smaller, right);
    assertTrue(smaller == left || smaller == right);
  }

  function testFuzz_MinIsCommutative(uint256 left, uint256 right) public view {
    assertEq(harness.min(left, right), harness.min(right, left));
  }

  function test_HasOpposingDemandRequiresBothSides() public view {
    assertFalse(harness.hasOpposingDemand(0, 0));
    assertFalse(harness.hasOpposingDemand(1, 0));
    assertFalse(harness.hasOpposingDemand(0, 1));
    assertTrue(harness.hasOpposingDemand(1, 1));
  }

  function testFuzz_HasOpposingDemandMatchesNonzeroCheck(
    uint256 yesCovering,
    uint256 noCovering
  ) public view {
    bool expected = yesCovering != 0 && noCovering != 0;

    assertEq(harness.hasOpposingDemand(yesCovering, noCovering), expected);
  }
}
