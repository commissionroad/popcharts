// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {TickMath} from "@uniswap/v4-periphery/lib/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {OrderValidation} from "../../contracts/v4/libraries/OrderValidation.sol";
import {V4DeltaSettlement} from "../../contracts/v4/libraries/V4DeltaSettlement.sol";
import {PartialFillMathHarness} from "./harnesses/PartialFillMathHarness.sol";

contract PartialFillMathTest is Test {
  int256 private constant MIN_TICK = -887_272;
  int256 private constant MAX_TICK = 887_272;

  PartialFillMathHarness private harness;

  function setUp() public {
    harness = new PartialFillMathHarness();
  }

  function test_FloorAndCeilRoundPositiveTicks() public view {
    assertEq(harness.floorToSpacing(15, 10), 10);
    assertEq(harness.ceilToSpacing(15, 10), 20);
    assertEq(harness.floorToSpacing(20, 10), 20);
    assertEq(harness.ceilToSpacing(20, 10), 20);
  }

  function test_FloorAndCeilRoundNegativeTicksTowardTheirDirections() public view {
    assertEq(harness.floorToSpacing(-15, 10), -20);
    assertEq(harness.ceilToSpacing(-15, 10), -10);
    assertEq(harness.floorToSpacing(-20, 10), -20);
    assertEq(harness.ceilToSpacing(-20, 10), -20);
  }

  function test_FloorToSpacingRejectsNonPositiveSpacing() public {
    vm.expectRevert(abi.encodeWithSelector(OrderValidation.InvalidTickSpacing.selector, int24(0)));
    harness.floorToSpacing(10, 0);

    vm.expectRevert(abi.encodeWithSelector(OrderValidation.InvalidTickSpacing.selector, int24(-1)));
    harness.floorToSpacing(10, -1);
  }

  function test_CeilToSpacingRejectsNonPositiveSpacing() public {
    vm.expectRevert(abi.encodeWithSelector(OrderValidation.InvalidTickSpacing.selector, int24(0)));
    harness.ceilToSpacing(10, 0);

    vm.expectRevert(abi.encodeWithSelector(OrderValidation.InvalidTickSpacing.selector, int24(-1)));
    harness.ceilToSpacing(10, -1);
  }

  function testFuzz_FloorCeilProperties(int24 tick, int24 tickSpacing) public view {
    tick = int24(bound(int256(tick), MIN_TICK, MAX_TICK));
    tickSpacing = int24(bound(int256(tickSpacing), 1, 32_767));

    int24 floorTick = harness.floorToSpacing(tick, tickSpacing);
    int24 ceilTick = harness.ceilToSpacing(tick, tickSpacing);

    assertLe(floorTick, tick);
    assertLt(int256(tick), int256(floorTick) + int256(tickSpacing));
    assertEq(floorTick % tickSpacing, 0);
    assertEq(ceilTick, floorTick == tick ? tick : floorTick + tickSpacing);
  }

  function test_RemainingRangeZeroForOneRoundsClampsAndIndexes() public view {
    _assertRemainingRange(10, true, -20, 40, 5, 10, 40, 10);
    _assertRemainingRange(10, true, -20, 40, -30, -20, 40, -20);
    _assertRemainingRange(10, true, -20, 40, 20, 20, 40, 30);
    _assertRemainingRange(10, true, -20, 25, 20, 20, 25, 25);
  }

  function test_RemainingRangeZeroForOneCollapsesAtUpperTick() public view {
    _assertRemainingRange(10, true, -20, 40, 40, 40, 40, 40);
    _assertRemainingRange(10, true, -20, 40, 100, 40, 40, 40);
  }

  function test_RemainingRangeOneForZeroRoundsClampsAndIndexes() public view {
    _assertRemainingRange(10, false, -20, 40, 5, -20, 0, 0);
    _assertRemainingRange(10, false, -20, 40, 50, -20, 40, 40);
    _assertRemainingRange(10, false, -20, 40, 20, -20, 20, 10);
    _assertRemainingRange(10, false, -15, 40, -10, -15, -10, -15);
  }

  function test_RemainingRangeOneForZeroCollapsesAtLowerTick() public view {
    _assertRemainingRange(10, false, -20, 40, -20, -20, -20, -20);
    _assertRemainingRange(10, false, -20, 40, -100, -20, -20, -20);
  }

  function testFuzz_RemainingRangeStaysWithinOriginalOrder(
    int24 tickSpacing,
    bool zeroForOne,
    int24 orderTickLower,
    int24 orderTickUpper,
    int24 toTick
  ) public view {
    tickSpacing = int24(bound(int256(tickSpacing), 1, 32_767));
    orderTickLower = int24(bound(int256(orderTickLower), MIN_TICK, MAX_TICK - 1));
    orderTickUpper = int24(bound(int256(orderTickUpper), int256(orderTickLower) + 1, MAX_TICK));
    toTick = int24(bound(int256(toTick), MIN_TICK, MAX_TICK));

    (int24 tickLower, int24 tickUpper, int24 indexedTick) = harness.remainingRange(
      tickSpacing,
      zeroForOne,
      orderTickLower,
      orderTickUpper,
      toTick
    );

    assertLe(orderTickLower, tickLower);
    assertLe(tickLower, tickUpper);
    assertLe(tickUpper, orderTickUpper);
    if (tickLower < tickUpper) {
      assertGe(indexedTick, tickLower);
      assertLe(indexedTick, tickUpper);
    }
  }

  function test_RemainingLiquidityIsZeroForCollapsedRange() public view {
    assertEq(harness.remainingLiquidity(true, 10, 10, 100, 0), 0);
    assertEq(harness.remainingLiquidity(false, 20, 10, 0, 100), 0);
  }

  function test_RemainingLiquidityIsZeroForZeroInputDelta() public view {
    assertEq(harness.remainingLiquidity(true, -100, 100, 0, 7), 0);
    assertEq(harness.remainingLiquidity(false, -100, 100, 7, 0), 0);
  }

  function test_RemainingLiquidityMatchesDirectAmount0Calculation() public view {
    uint256 amount = 1e18;
    uint128 expected = LiquidityAmounts.getLiquidityForAmount0(
      TickMath.getSqrtPriceAtTick(-100),
      TickMath.getSqrtPriceAtTick(100),
      amount
    );

    assertEq(harness.remainingLiquidity(true, -100, 100, int128(int256(amount)), 0), expected);
  }

  function test_RemainingLiquidityMatchesDirectAmount1Calculation() public view {
    uint256 amount = 1e18;
    uint128 expected = LiquidityAmounts.getLiquidityForAmount1(
      TickMath.getSqrtPriceAtTick(-100),
      TickMath.getSqrtPriceAtTick(100),
      amount
    );

    assertEq(harness.remainingLiquidity(false, -100, 100, 0, int128(int256(amount))), expected);
  }

  function test_RemainingLiquidityRejectsNegativeDeltaComponent() public {
    vm.expectRevert(
      abi.encodeWithSelector(
        V4DeltaSettlement.UnexpectedNegativeDelta.selector,
        int128(-1),
        int128(0)
      )
    );
    harness.remainingLiquidity(true, -100, 100, -1, 0);

    vm.expectRevert(
      abi.encodeWithSelector(
        V4DeltaSettlement.UnexpectedNegativeDelta.selector,
        int128(0),
        int128(-1)
      )
    );
    harness.remainingLiquidity(false, -100, 100, 0, -1);
  }

  function test_LiquidityForAmountMatchesDirectCalculations() public view {
    uint256 amount = 1e18;
    uint160 sqrtPriceLower = TickMath.getSqrtPriceAtTick(-100);
    uint160 sqrtPriceUpper = TickMath.getSqrtPriceAtTick(100);

    assertEq(
      harness.liquidityForAmount(true, -100, 100, amount),
      LiquidityAmounts.getLiquidityForAmount0(sqrtPriceLower, sqrtPriceUpper, amount)
    );
    assertEq(
      harness.liquidityForAmount(false, -100, 100, amount),
      LiquidityAmounts.getLiquidityForAmount1(sqrtPriceLower, sqrtPriceUpper, amount)
    );
  }

  function test_InitialIndexedTickUsesPartialOrFullThreshold() public view {
    assertEq(harness.initialIndexedTick(true, -10, 20, true), -10);
    assertEq(harness.initialIndexedTick(false, -10, 20, true), 20);
    assertEq(harness.initialIndexedTick(true, -10, 20, false), 20);
    assertEq(harness.initialIndexedTick(false, -10, 20, false), -10);
  }

  function _assertRemainingRange(
    int24 tickSpacing,
    bool zeroForOne,
    int24 orderTickLower,
    int24 orderTickUpper,
    int24 toTick,
    int24 expectedLower,
    int24 expectedUpper,
    int24 expectedIndexed
  ) private view {
    (int24 tickLower, int24 tickUpper, int24 indexedTick) = harness.remainingRange(
      tickSpacing,
      zeroForOne,
      orderTickLower,
      orderTickUpper,
      toTick
    );
    assertEq(tickLower, expectedLower);
    assertEq(tickUpper, expectedUpper);
    assertEq(indexedTick, expectedIndexed);
  }
}
