// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {OrderValidation} from "../../contracts/v4/libraries/OrderValidation.sol";
import {OrderValidationHarness} from "./harnesses/OrderValidationHarness.sol";

contract OrderValidationTest is Test {
  int256 private constant MIN_TICK = -887_272;
  int256 private constant MAX_TICK = 887_272;

  OrderValidationHarness private harness;

  function setUp() public {
    harness = new OrderValidationHarness();
  }

  function test_ValidateTickRangeAcceptsAlignedIncreasingRange() public view {
    harness.validateTickRange(-20, 30, 10);
  }

  function test_ValidateTickRangeRejectsZeroSpacing() public {
    vm.expectRevert(abi.encodeWithSelector(OrderValidation.InvalidTickSpacing.selector, int24(0)));
    harness.validateTickRange(-20, 30, 0);
  }

  function test_ValidateTickRangeRejectsNegativeSpacing() public {
    vm.expectRevert(
      abi.encodeWithSelector(OrderValidation.InvalidTickSpacing.selector, int24(-10))
    );
    harness.validateTickRange(-20, 30, -10);
  }

  function test_ValidateTickRangeRejectsEqualTicks() public {
    vm.expectRevert(
      abi.encodeWithSelector(OrderValidation.InvalidTickRange.selector, int24(20), int24(20))
    );
    harness.validateTickRange(20, 20, 10);
  }

  function test_ValidateTickRangeRejectsInvertedTicks() public {
    vm.expectRevert(
      abi.encodeWithSelector(OrderValidation.InvalidTickRange.selector, int24(30), int24(20))
    );
    harness.validateTickRange(30, 20, 10);
  }

  function test_ValidateTickRangeRejectsMisalignedLowerTick() public {
    vm.expectRevert(
      abi.encodeWithSelector(OrderValidation.TickNotAligned.selector, int24(-15), int24(10))
    );
    harness.validateTickRange(-15, 20, 10);
  }

  function test_ValidateTickRangeRejectsMisalignedUpperTick() public {
    vm.expectRevert(
      abi.encodeWithSelector(OrderValidation.TickNotAligned.selector, int24(15), int24(10))
    );
    harness.validateTickRange(-20, 15, 10);
  }

  function test_ValidateOneSidedZeroForOneRequiresCurrentTickBelowRange() public view {
    harness.validateOneSidedOrder(true, -11, -10, 20);
  }

  function test_ValidateOneSidedZeroForOneRejectsLowerBoundary() public {
    vm.expectRevert(
      abi.encodeWithSelector(
        OrderValidation.InvalidOrderSide.selector,
        true,
        int24(-10),
        int24(-10),
        int24(20)
      )
    );
    harness.validateOneSidedOrder(true, -10, -10, 20);
  }

  function test_ValidateOneSidedOneForZeroRequiresCurrentTickAboveRange() public view {
    harness.validateOneSidedOrder(false, 21, -10, 20);
  }

  function test_ValidateOneSidedOneForZeroRejectsUpperBoundary() public {
    vm.expectRevert(
      abi.encodeWithSelector(
        OrderValidation.InvalidOrderSide.selector,
        false,
        int24(20),
        int24(-10),
        int24(20)
      )
    );
    harness.validateOneSidedOrder(false, 20, -10, 20);
  }

  function test_ThresholdHelpersMapOrderSides() public view {
    assertEq(harness.partialThresholdTick(true, -10, 20), -10);
    assertEq(harness.partialThresholdTick(false, -10, 20), 20);
    assertEq(harness.thresholdTick(true, -10, 20), 20);
    assertEq(harness.thresholdTick(false, -10, 20), -10);
  }

  function test_ThresholdCrossingUsesStrictOriginAndInclusiveDestination() public view {
    assertTrue(harness.isThresholdCrossed(true, 19, 20, -10, 20));
    assertTrue(harness.isThresholdCrossed(true, -50, 21, -10, 20));
    assertFalse(harness.isThresholdCrossed(true, 20, 21, -10, 20));
    assertFalse(harness.isThresholdCrossed(true, 19, 19, -10, 20));

    assertTrue(harness.isThresholdCrossed(false, -9, -10, -10, 20));
    assertTrue(harness.isThresholdCrossed(false, 50, -11, -10, 20));
    assertFalse(harness.isThresholdCrossed(false, -10, -11, -10, 20));
    assertFalse(harness.isThresholdCrossed(false, -9, -9, -10, 20));
  }

  function test_IndexedTickCrossingUsesStrictOriginAndInclusiveDestination() public view {
    assertTrue(harness.isIndexedTickCrossed(true, 9, 10, 10));
    assertTrue(harness.isIndexedTickCrossed(true, -20, 11, 10));
    assertFalse(harness.isIndexedTickCrossed(true, 10, 11, 10));
    assertFalse(harness.isIndexedTickCrossed(true, 9, 9, 10));

    assertTrue(harness.isIndexedTickCrossed(false, 11, 10, 10));
    assertTrue(harness.isIndexedTickCrossed(false, 20, 9, 10));
    assertFalse(harness.isIndexedTickCrossed(false, 10, 9, 10));
    assertFalse(harness.isIndexedTickCrossed(false, 11, 11, 10));
  }

  function testFuzz_ThresholdCrossedImpliesToTickBeyondThreshold(
    bool zeroForOne,
    int24 fromTick,
    int24 toTick,
    int24 tickLower,
    int24 tickUpper
  ) public view {
    tickLower = int24(bound(int256(tickLower), MIN_TICK, MAX_TICK - 1));
    tickUpper = int24(bound(int256(tickUpper), int256(tickLower) + 1, MAX_TICK));
    fromTick = int24(bound(int256(fromTick), MIN_TICK, MAX_TICK));
    toTick = int24(bound(int256(toTick), MIN_TICK, MAX_TICK));

    bool crossed = harness.isThresholdCrossed(zeroForOne, fromTick, toTick, tickLower, tickUpper);
    if (crossed) {
      if (zeroForOne) {
        assertLt(fromTick, tickUpper);
        assertGe(toTick, tickUpper);
      } else {
        assertGt(fromTick, tickLower);
        assertLe(toTick, tickLower);
      }
    }
  }

  function testFuzz_ThresholdCrossingHasMirrorSymmetry(
    bool zeroForOne,
    int24 fromTick,
    int24 toTick,
    int24 tickLower,
    int24 tickUpper
  ) public view {
    tickLower = int24(bound(int256(tickLower), MIN_TICK, MAX_TICK - 1));
    tickUpper = int24(bound(int256(tickUpper), int256(tickLower) + 1, MAX_TICK));
    fromTick = int24(bound(int256(fromTick), MIN_TICK, MAX_TICK));
    toTick = int24(bound(int256(toTick), MIN_TICK, MAX_TICK));

    bool crossed = harness.isThresholdCrossed(zeroForOne, fromTick, toTick, tickLower, tickUpper);
    bool mirrored = harness.isThresholdCrossed(
      !zeroForOne,
      int24(-int256(fromTick)),
      int24(-int256(toTick)),
      int24(-int256(tickUpper)),
      int24(-int256(tickLower))
    );

    assertEq(crossed, mirrored);
  }
}
