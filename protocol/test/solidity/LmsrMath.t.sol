// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {LmsrMathHarness} from "./harnesses/LmsrMathHarness.sol";
import {LmsrMath} from "../../contracts/libraries/LmsrMath.sol";
import {MarketTypes} from "../../contracts/types/MarketTypes.sol";

contract LmsrMathTest is Test {
  uint256 private constant WAD = 1e18;
  uint256 private constant DEFAULT_B = 5_000 * WAD;
  uint256 private constant DEFAULT_SHARES = 100 * WAD;

  LmsrMathHarness private harness;

  function setUp() public {
    harness = new LmsrMathHarness();
  }

  function test_OpeningPathIsZeroAtEvenProbability() public view {
    assertEq(harness.openingPath((50 * WAD) / 100, DEFAULT_B), 0);
  }

  function test_OpeningPathTracksProbabilityDirection() public view {
    int256 lowPath = harness.openingPath((20 * WAD) / 100, DEFAULT_B);
    int256 evenPath = harness.openingPath((50 * WAD) / 100, DEFAULT_B);
    int256 highPath = harness.openingPath((80 * WAD) / 100, DEFAULT_B);

    assertLt(lowPath, 0);
    assertEq(evenPath, 0);
    assertGt(highPath, 0);
    assertApproxEqAbs(lowPath + highPath, 0, 10);
  }

  function test_QuoteAtZeroPathIsSymmetricBetweenSides() public view {
    MarketTypes.ReceiptQuote memory yesQuote = harness.quoteBinaryReceipt(
      0,
      MarketTypes.Side.Yes,
      DEFAULT_SHARES,
      DEFAULT_B
    );
    MarketTypes.ReceiptQuote memory noQuote = harness.quoteBinaryReceipt(
      0,
      MarketTypes.Side.No,
      DEFAULT_SHARES,
      DEFAULT_B
    );

    assertEq(yesQuote.rLow, 0);
    assertEq(yesQuote.rHigh, int256(DEFAULT_SHARES));
    assertEq(noQuote.rLow, -int256(DEFAULT_SHARES));
    assertEq(noQuote.rHigh, 0);
    assertApproxEqAbs(yesQuote.cost, noQuote.cost, 10);
  }

  function test_QuoteCostIncreasesWithShares() public view {
    uint256 smallShares = 25 * WAD;
    uint256 largeShares = 100 * WAD;
    uint256 smallCost = harness
      .quoteBinaryReceipt(0, MarketTypes.Side.Yes, smallShares, DEFAULT_B)
      .cost;
    uint256 largeCost = harness
      .quoteBinaryReceipt(0, MarketTypes.Side.Yes, largeShares, DEFAULT_B)
      .cost;

    assertGt(largeCost, smallCost);
    assertGt(smallCost, 0);
  }

  function test_YesCostRisesAfterYesDemand() public view {
    uint256 shares = 100 * WAD;
    uint256 initialCost = harness
      .quoteBinaryReceipt(0, MarketTypes.Side.Yes, shares, DEFAULT_B)
      .cost;
    MarketTypes.ReceiptQuote memory firstQuote = harness.quoteBinaryReceipt(
      0,
      MarketTypes.Side.Yes,
      shares,
      DEFAULT_B
    );
    uint256 nextCost = harness
      .quoteBinaryReceipt(firstQuote.rHigh, MarketTypes.Side.Yes, shares, DEFAULT_B)
      .cost;

    assertGt(nextCost, initialCost);
  }

  function test_NoCostFallsAfterYesDemand() public view {
    uint256 shares = 100 * WAD;
    MarketTypes.ReceiptQuote memory yesQuote = harness.quoteBinaryReceipt(
      0,
      MarketTypes.Side.Yes,
      shares,
      DEFAULT_B
    );
    uint256 initialNoCost = harness
      .quoteBinaryReceipt(0, MarketTypes.Side.No, shares, DEFAULT_B)
      .cost;
    uint256 nextNoCost = harness
      .quoteBinaryReceipt(yesQuote.rHigh, MarketTypes.Side.No, shares, DEFAULT_B)
      .cost;

    assertLt(nextNoCost, initialNoCost);
  }

  function test_RevertsForInvalidOpeningProbability() public {
    vm.expectRevert(abi.encodeWithSelector(LmsrMath.InvalidProbability.selector, 0));
    harness.validateOpeningProbability(0);

    vm.expectRevert(abi.encodeWithSelector(LmsrMath.InvalidProbability.selector, WAD));
    harness.validateOpeningProbability(WAD);
  }

  function test_RevertsForInvalidLiquidityParameter() public {
    vm.expectRevert(LmsrMath.InvalidLiquidityParameter.selector);
    harness.validateLiquidityParameter(0);

    vm.expectRevert(LmsrMath.InvalidLiquidityParameter.selector);
    harness.openingPath((50 * WAD) / 100, 0);

    vm.expectRevert(LmsrMath.InvalidLiquidityParameter.selector);
    harness.quoteBinaryReceipt(0, MarketTypes.Side.Yes, DEFAULT_SHARES, 0);
  }

  function test_RevertsWhenSharesCannotFitSignedMath() public {
    vm.expectRevert(abi.encodeWithSelector(LmsrMath.ValueTooLarge.selector, type(uint256).max));
    harness.quoteBinaryReceipt(0, MarketTypes.Side.Yes, type(uint256).max, DEFAULT_B);
  }

  function test_RevertsWhenQuoteCostRoundsToZero() public {
    vm.expectRevert(LmsrMath.QuoteCostTooSmall.selector);
    harness.quoteBinaryReceipt(0, MarketTypes.Side.Yes, 1, 100_000 * WAD);
  }

  function testFuzz_OpeningPathIsComplementSymmetric(
    uint256 probabilityRaw,
    uint256 bRaw
  ) public view {
    uint256 probability = bound(probabilityRaw, WAD / 1_000, WAD - (WAD / 1_000));
    uint256 liquidityParameter = bound(bRaw, WAD, 100_000 * WAD);

    int256 path = harness.openingPath(probability, liquidityParameter);
    int256 complementPath = harness.openingPath(WAD - probability, liquidityParameter);

    assertApproxEqAbs(path + complementPath, 0, 1e12);
  }

  function testFuzz_QuotesHavePositiveCostAndExpectedIntervals(
    uint256 pathRaw,
    uint256 sharesRaw,
    uint256 bRaw
  ) public view {
    int256 path = int256(bound(pathRaw, 0, 2_000 * WAD)) - int256(1_000 * WAD);
    uint256 shares = bound(sharesRaw, WAD / 1_000, 1_000 * WAD);
    uint256 liquidityParameter = bound(bRaw, 100 * WAD, 100_000 * WAD);

    MarketTypes.ReceiptQuote memory yesQuote = harness.quoteBinaryReceipt(
      path,
      MarketTypes.Side.Yes,
      shares,
      liquidityParameter
    );
    MarketTypes.ReceiptQuote memory noQuote = harness.quoteBinaryReceipt(
      path,
      MarketTypes.Side.No,
      shares,
      liquidityParameter
    );

    assertGt(yesQuote.cost, 0);
    assertGt(noQuote.cost, 0);
    assertEq(yesQuote.rLow, path);
    assertEq(yesQuote.rHigh, path + int256(shares));
    assertEq(noQuote.rLow, path - int256(shares));
    assertEq(noQuote.rHigh, path);
  }
}
