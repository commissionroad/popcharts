// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {MockCollateral} from "../../contracts/mocks/MockCollateral.sol";
import {MockFeeCollateral} from "../../contracts/mocks/MockFeeCollateral.sol";
import {OutcomeToken} from "../../contracts/postgrad/OutcomeToken.sol";
import {TrueoStyleBinaryMarket} from "../../contracts/postgrad/TrueoStyleBinaryMarket.sol";
import {MarketTypes} from "../../contracts/types/MarketTypes.sol";
import {SixDecimalCollateral} from "./mocks/SixDecimalCollateral.sol";

contract TrueoStyleBinaryMarketTest is Test {
  uint256 private constant WAD = 1e18;
  uint256 private constant SIX_DECIMAL_UNIT = 1e6;

  address private trader = makeAddr("trader");
  address private alice = makeAddr("alice");
  address private bob = makeAddr("bob");
  address private retainedMinter = makeAddr("retained-minter");
  address private resolver = makeAddr("resolver");

  MockCollateral private collateral;
  TrueoStyleBinaryMarket private market;
  OutcomeToken private yesToken;
  OutcomeToken private noToken;

  function setUp() public {
    collateral = new MockCollateral();
    market = _deployMarket(address(collateral), 18);
    yesToken = market.yesToken();
    noToken = market.noToken();
  }

  function test_ConstructorDeploysOutcomeTokens() public view {
    assertEq(address(market.collateralToken()), address(collateral));
    assertEq(market.collateralDecimals(), 18);
    assertEq(market.outcomeDecimals(), 18);
    assertEq(market.retainedMinter(), retainedMinter);
    assertEq(market.resolver(), resolver);
    assertEq(uint256(market.status()), uint256(TrueoStyleBinaryMarket.Status.Trading));
    assertEq(yesToken.market(), address(market));
    assertEq(noToken.market(), address(market));
    assertEq(yesToken.name(), "Pop Charts Test YES");
    assertEq(noToken.name(), "Pop Charts Test NO");
    assertEq(yesToken.symbol(), "PCTYES");
    assertEq(noToken.symbol(), "PCTNO");
  }

  function test_MintCompleteSetsDepositsCollateralAndMintsBothSides() public {
    _fundAndApprove(trader, 100 * WAD);

    vm.prank(trader);
    uint256 outcomeAmount = market.mintCompleteSets(trader, 100 * WAD);

    assertEq(outcomeAmount, 100 * WAD);
    assertEq(collateral.balanceOf(address(market)), 100 * WAD);
    assertEq(collateral.balanceOf(trader), 0);
    assertEq(yesToken.balanceOf(trader), 100 * WAD);
    assertEq(noToken.balanceOf(trader), 100 * WAD);
    assertEq(yesToken.totalSupply(), 100 * WAD);
    assertEq(noToken.totalSupply(), 100 * WAD);
    assertEq(market.collateralOutcomeCapacity(), 100 * WAD);
  }

  function test_MergeCompleteSetsBurnsBothSidesAndReturnsCollateral() public {
    _mintCompleteSets(trader, 100 * WAD);

    vm.prank(trader);
    uint256 collateralAmount = market.mergeCompleteSets(40 * WAD);

    assertEq(collateralAmount, 40 * WAD);
    assertEq(collateral.balanceOf(address(market)), 60 * WAD);
    assertEq(collateral.balanceOf(trader), 40 * WAD);
    assertEq(yesToken.balanceOf(trader), 60 * WAD);
    assertEq(noToken.balanceOf(trader), 60 * WAD);
    assertEq(yesToken.totalSupply(), 60 * WAD);
    assertEq(noToken.totalSupply(), 60 * WAD);
  }

  function test_FundRetainedCollateralAndMintRetainedSides() public {
    _fundRetainedMinter(100 * WAD);

    vm.startPrank(retainedMinter);
    uint256 outcomeCapacity = market.fundRetainedCollateral(100 * WAD);
    market.mintRetainedSide(alice, MarketTypes.Side.Yes, 100 * WAD);
    market.mintRetainedSide(bob, MarketTypes.Side.No, 100 * WAD);
    vm.stopPrank();

    assertEq(outcomeCapacity, 100 * WAD);
    assertEq(collateral.balanceOf(address(market)), 100 * WAD);
    assertEq(yesToken.balanceOf(alice), 100 * WAD);
    assertEq(noToken.balanceOf(bob), 100 * WAD);
    assertEq(yesToken.totalSupply(), 100 * WAD);
    assertEq(noToken.totalSupply(), 100 * WAD);
  }

  function test_RetainedMintCannotExceedMarketLevelBacking() public {
    _fundRetainedMinter(100 * WAD);

    vm.startPrank(retainedMinter);
    market.fundRetainedCollateral(100 * WAD);
    market.mintRetainedSide(alice, MarketTypes.Side.Yes, 100 * WAD);

    vm.expectRevert(
      abi.encodeWithSelector(
        TrueoStyleBinaryMarket.InsolventOutcomeBacking.selector,
        100 * WAD,
        101 * WAD
      )
    );
    market.mintRetainedSide(alice, MarketTypes.Side.Yes, 1 * WAD);
    vm.stopPrank();

    assertEq(yesToken.totalSupply(), 100 * WAD);
  }

  function test_OnlyRetainedMinterCanFundAndMintRetainedClaims() public {
    _fundAndApprove(trader, 100 * WAD);

    vm.prank(trader);
    vm.expectRevert(
      abi.encodeWithSelector(TrueoStyleBinaryMarket.UnauthorizedRetainedMinter.selector, trader)
    );
    market.fundRetainedCollateral(100 * WAD);

    vm.prank(trader);
    vm.expectRevert(
      abi.encodeWithSelector(TrueoStyleBinaryMarket.UnauthorizedRetainedMinter.selector, trader)
    );
    market.mintRetainedSide(trader, MarketTypes.Side.Yes, 1 * WAD);
  }

  function test_ResolveAndRedeemWinningTokens() public {
    _mintCompleteSets(trader, 100 * WAD);

    vm.prank(resolver);
    market.resolve(MarketTypes.Side.Yes);

    vm.prank(trader);
    uint256 collateralAmount = market.redeem(MarketTypes.Side.Yes, 40 * WAD);

    assertEq(collateralAmount, 40 * WAD);
    assertEq(collateral.balanceOf(trader), 40 * WAD);
    assertEq(collateral.balanceOf(address(market)), 60 * WAD);
    assertEq(yesToken.balanceOf(trader), 60 * WAD);
    assertEq(noToken.balanceOf(trader), 100 * WAD);
    assertEq(yesToken.totalSupply(), 60 * WAD);
  }

  function test_LosingSideCannotRedeem() public {
    _mintCompleteSets(trader, 100 * WAD);

    vm.prank(resolver);
    market.resolve(MarketTypes.Side.Yes);

    vm.prank(trader);
    vm.expectRevert(
      abi.encodeWithSelector(
        TrueoStyleBinaryMarket.LosingSideCannotRedeem.selector,
        MarketTypes.Side.No,
        MarketTypes.Side.Yes
      )
    );
    market.redeem(MarketTypes.Side.No, 1 * WAD);
  }

  function test_OnlyResolverCanResolveOrCancel() public {
    vm.prank(trader);
    vm.expectRevert(
      abi.encodeWithSelector(TrueoStyleBinaryMarket.UnauthorizedResolver.selector, trader)
    );
    market.resolve(MarketTypes.Side.Yes);

    vm.prank(trader);
    vm.expectRevert(
      abi.encodeWithSelector(TrueoStyleBinaryMarket.UnauthorizedResolver.selector, trader)
    );
    market.cancel();
  }

  function test_MergeIsUnavailableAfterResolution() public {
    _mintCompleteSets(trader, 100 * WAD);

    vm.prank(resolver);
    market.resolve(MarketTypes.Side.Yes);

    vm.prank(trader);
    vm.expectRevert(
      abi.encodeWithSelector(
        TrueoStyleBinaryMarket.InvalidStatus.selector,
        TrueoStyleBinaryMarket.Status.Resolved,
        TrueoStyleBinaryMarket.Status.Trading
      )
    );
    market.mergeCompleteSets(1 * WAD);
  }

  function test_CancelledMarketRedeemsAtHalfValue() public {
    _mintCompleteSets(trader, 100 * WAD);

    vm.prank(resolver);
    market.cancel();

    vm.prank(trader);
    uint256 yesCollateral = market.redeemCancelled(100 * WAD, 0);

    vm.prank(trader);
    uint256 noCollateral = market.redeemCancelled(0, 100 * WAD);

    assertEq(yesCollateral, 50 * WAD);
    assertEq(noCollateral, 50 * WAD);
    assertEq(collateral.balanceOf(trader), 100 * WAD);
    assertEq(collateral.balanceOf(address(market)), 0);
    assertEq(yesToken.totalSupply(), 0);
    assertEq(noToken.totalSupply(), 0);
  }

  function test_SixDecimalCollateralConvertsToEighteenDecimalOutcomes() public {
    SixDecimalCollateral sixDecimalCollateral = new SixDecimalCollateral();
    TrueoStyleBinaryMarket sixDecimalMarket = _deployMarket(address(sixDecimalCollateral), 18);
    OutcomeToken sixDecimalYes = sixDecimalMarket.yesToken();
    OutcomeToken sixDecimalNo = sixDecimalMarket.noToken();

    sixDecimalCollateral.mint(trader, 100 * SIX_DECIMAL_UNIT);
    vm.prank(trader);
    sixDecimalCollateral.approve(address(sixDecimalMarket), 100 * SIX_DECIMAL_UNIT);

    vm.prank(trader);
    uint256 outcomeAmount = sixDecimalMarket.mintCompleteSets(trader, 100 * SIX_DECIMAL_UNIT);

    assertEq(outcomeAmount, 100 * WAD);
    assertEq(sixDecimalYes.balanceOf(trader), 100 * WAD);
    assertEq(sixDecimalNo.balanceOf(trader), 100 * WAD);
    assertEq(sixDecimalCollateral.balanceOf(address(sixDecimalMarket)), 100 * SIX_DECIMAL_UNIT);

    vm.prank(trader);
    uint256 returnedCollateral = sixDecimalMarket.mergeCompleteSets(25 * WAD);

    assertEq(returnedCollateral, 25 * SIX_DECIMAL_UNIT);
    assertEq(sixDecimalCollateral.balanceOf(trader), 25 * SIX_DECIMAL_UNIT);
  }

  function test_SixDecimalCollateralRejectsOutcomeDust() public {
    SixDecimalCollateral sixDecimalCollateral = new SixDecimalCollateral();
    TrueoStyleBinaryMarket sixDecimalMarket = _deployMarket(address(sixDecimalCollateral), 18);

    vm.expectRevert(abi.encodeWithSelector(TrueoStyleBinaryMarket.AmountHasDust.selector, 1, 1e12));
    sixDecimalMarket.collateralAmountForOutcome(1);
  }

  function test_FeeOnTransferCollateralIsRejected() public {
    MockFeeCollateral feeCollateral = new MockFeeCollateral();
    TrueoStyleBinaryMarket feeMarket = _deployMarket(address(feeCollateral), 18);
    feeCollateral.mint(trader, 100 * WAD);

    vm.prank(trader);
    feeCollateral.approve(address(feeMarket), 100 * WAD);

    vm.prank(trader);
    vm.expectRevert(
      abi.encodeWithSelector(
        TrueoStyleBinaryMarket.InvalidCollateralTransfer.selector,
        100 * WAD,
        99 * WAD
      )
    );
    feeMarket.mintCompleteSets(trader, 100 * WAD);
  }

  function _deployMarket(
    address collateralToken,
    uint8 outcomeDecimals
  ) private returns (TrueoStyleBinaryMarket) {
    return
      new TrueoStyleBinaryMarket({
        collateralToken_: collateralToken,
        owner_: address(this),
        retainedMinter_: retainedMinter,
        resolver_: resolver,
        marketName_: "Pop Charts Test",
        marketSymbol_: "PCT",
        outcomeDecimals_: outcomeDecimals
      });
  }

  function _fundAndApprove(address account, uint256 amount) private {
    collateral.mint(account, amount);
    vm.prank(account);
    collateral.approve(address(market), amount);
  }

  function _fundRetainedMinter(uint256 amount) private {
    collateral.mint(retainedMinter, amount);
    vm.prank(retainedMinter);
    collateral.approve(address(market), amount);
  }

  function _mintCompleteSets(address account, uint256 collateralAmount) private {
    _fundAndApprove(account, collateralAmount);
    vm.prank(account);
    market.mintCompleteSets(account, collateralAmount);
  }
}
