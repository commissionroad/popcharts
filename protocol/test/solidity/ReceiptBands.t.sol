// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {ReceiptBandsHarness} from "./harnesses/ReceiptBandsHarness.sol";
import {ReceiptBands} from "../../contracts/libraries/ReceiptBands.sol";

contract ReceiptBandsTest is Test {
  int256 private constant WAD = 1e18;
  // Path coordinates in practice stay far below this; keeps fuzz arithmetic overflow-free.
  int256 private constant PATH_BOUND = 1e36;

  ReceiptBandsHarness private harness;

  function setUp() public {
    harness = new ReceiptBandsHarness();
  }

  function test_WidthReturnsBandSize() public view {
    assertEq(harness.width(0, 5 * WAD), uint256(5 * WAD));
    assertEq(harness.width(-3 * WAD, 2 * WAD), uint256(5 * WAD));
    assertEq(harness.width(-7 * WAD, -6 * WAD), uint256(WAD));
  }

  function test_WidthRevertsWhenBandIsEmpty() public {
    vm.expectRevert(abi.encodeWithSelector(ReceiptBands.EmptyBand.selector, WAD, WAD));
    harness.width(WAD, WAD);
  }

  function test_WidthRevertsWhenBandIsInverted() public {
    vm.expectRevert(abi.encodeWithSelector(ReceiptBands.EmptyBand.selector, 2 * WAD, WAD));
    harness.width(2 * WAD, WAD);
  }

  function testFuzz_WidthMatchesEndpointDifference(int256 lower, int256 upper) public view {
    lower = bound(lower, -PATH_BOUND, PATH_BOUND - 1);
    upper = bound(upper, lower + 1, PATH_BOUND);

    assertEq(harness.width(lower, upper), uint256(upper - lower));
  }

  function test_OverlapsDetectsSharedInterval() public view {
    assertTrue(harness.overlaps(0, 10, 5, 15));
    assertTrue(harness.overlaps(5, 15, 0, 10));
    assertTrue(harness.overlaps(-10, 1, 0, 10));
  }

  function test_ContainedBandOverlaps() public view {
    assertTrue(harness.overlaps(0, 10, 3, 4));
    assertTrue(harness.overlaps(3, 4, 0, 10));
  }

  function test_AdjacentHalfOpenBandsDoNotOverlap() public view {
    assertFalse(harness.overlaps(0, 5, 5, 10));
    assertFalse(harness.overlaps(5, 10, 0, 5));
  }

  function test_DisjointBandsDoNotOverlap() public view {
    assertFalse(harness.overlaps(-10, -5, 5, 10));
    assertFalse(harness.overlaps(5, 10, -10, -5));
  }

  function testFuzz_OverlapsIsSymmetric(
    int256 leftLower,
    int256 leftUpper,
    int256 rightLower,
    int256 rightUpper
  ) public view {
    leftLower = bound(leftLower, -PATH_BOUND, PATH_BOUND);
    leftUpper = bound(leftUpper, -PATH_BOUND, PATH_BOUND);
    rightLower = bound(rightLower, -PATH_BOUND, PATH_BOUND);
    rightUpper = bound(rightUpper, -PATH_BOUND, PATH_BOUND);

    assertEq(
      harness.overlaps(leftLower, leftUpper, rightLower, rightUpper),
      harness.overlaps(rightLower, rightUpper, leftLower, leftUpper)
    );
  }

  function testFuzz_BandOverlapsItself(int256 lower, int256 upper) public view {
    lower = bound(lower, -PATH_BOUND, PATH_BOUND - 1);
    upper = bound(upper, lower + 1, PATH_BOUND);

    assertTrue(harness.overlaps(lower, upper, lower, upper));
  }
}
