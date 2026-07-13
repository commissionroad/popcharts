// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {MockFeeCollateral} from "../../contracts/mocks/MockFeeCollateral.sol";
import {OutcomeToken} from "../../contracts/postgrad/OutcomeToken.sol";
import {CompleteSetBinaryMarket} from "../../contracts/postgrad/CompleteSetBinaryMarket.sol";
import {MarketTypes} from "../../contracts/types/MarketTypes.sol";
import {BaseTest} from "./BaseTest.sol";
import {ExcessDecimalCollateral} from "./mocks/ExcessDecimalCollateral.sol";
import {SixDecimalCollateral} from "./mocks/SixDecimalCollateral.sol";

contract CompleteSetBinaryMarketTest is BaseTest {
  uint256 private constant SIX_DECIMAL_UNIT = 1e6;

  address private trader = makeAddr("trader");
  address private alice = makeAddr("alice");
  address private bob = makeAddr("bob");
  address private retainedMinter = makeAddr("retained-minter");
  address private resolver = makeAddr("resolver");

  CompleteSetBinaryMarket private market;
  OutcomeToken private yesToken;
  OutcomeToken private noToken;

  function setUp() public override {
    super.setUp();
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
    assertEq(uint256(market.status()), uint256(CompleteSetBinaryMarket.Status.Trading));
    assertEq(yesToken.market(), address(market));
    assertEq(noToken.market(), address(market));
    assertEq(yesToken.name(), "Pop Charts Test YES");
    assertEq(noToken.name(), "Pop Charts Test NO");
    assertEq(yesToken.symbol(), "PCTYES");
    assertEq(noToken.symbol(), "PCTNO");
  }

  function test_ConstructorRejectsInvalidConfiguration() public {
    vm.expectRevert(CompleteSetBinaryMarket.InvalidCollateral.selector);
    _deployMarket(address(0), 18);

    vm.expectRevert(CompleteSetBinaryMarket.InvalidRetainedMinter.selector);
    _deployMarketWithConfig(
      address(collateral),
      address(this),
      address(0),
      resolver,
      18,
      uint64(block.timestamp),
      uint64(block.timestamp)
    );

    vm.expectRevert(CompleteSetBinaryMarket.InvalidResolver.selector);
    _deployMarketWithConfig(
      address(collateral),
      address(this),
      retainedMinter,
      address(0),
      18,
      uint64(block.timestamp),
      uint64(block.timestamp)
    );

    vm.expectRevert(
      abi.encodeWithSelector(CompleteSetBinaryMarket.UnsupportedDecimals.selector, 78)
    );
    _deployMarket(address(collateral), 78);

    ExcessDecimalCollateral excessDecimalCollateral = new ExcessDecimalCollateral();
    vm.expectRevert(
      abi.encodeWithSelector(CompleteSetBinaryMarket.UnsupportedDecimals.selector, 78)
    );
    _deployMarket(address(excessDecimalCollateral), 18);
  }

  function test_OutcomeTokensCanOnlyMintAndBurnThroughMarket() public {
    vm.prank(trader);
    vm.expectRevert(abi.encodeWithSelector(OutcomeToken.UnauthorizedMarket.selector, trader));
    yesToken.mint(trader, 1 * WAD);

    vm.prank(trader);
    vm.expectRevert(abi.encodeWithSelector(OutcomeToken.UnauthorizedMarket.selector, trader));
    yesToken.burnFrom(trader, 1 * WAD);
  }

  function test_ResolveRevertsBeforeYesNotBefore() public {
    uint64 yesGate = uint64(block.timestamp + 1 days);
    CompleteSetBinaryMarket gatedMarket = _deployMarketWithConfig(
      address(collateral),
      address(this),
      retainedMinter,
      resolver,
      18,
      yesGate,
      yesGate
    );

    vm.prank(resolver);
    vm.expectRevert(
      abi.encodeWithSelector(CompleteSetBinaryMarket.TooEarlyToResolve.selector, yesGate)
    );
    gatedMarket.resolve(MarketTypes.Side.Yes);

    // cancel() is intentionally not gated so a postponed market can cancel early.
    vm.prank(resolver);
    gatedMarket.cancel();
    assertEq(uint8(gatedMarket.status()), uint8(CompleteSetBinaryMarket.Status.Cancelled));
  }

  function test_ResolveYesSucceedsAtYesNotBefore() public {
    uint64 yesGate = uint64(block.timestamp + 1 days);
    CompleteSetBinaryMarket gatedMarket = _deployMarketWithConfig(
      address(collateral),
      address(this),
      retainedMinter,
      resolver,
      18,
      yesGate,
      yesGate
    );

    vm.warp(yesGate);
    vm.prank(resolver);
    gatedMarket.resolve(MarketTypes.Side.Yes);
    assertEq(uint8(gatedMarket.status()), uint8(CompleteSetBinaryMarket.Status.Resolved));
  }

  function test_ResolveNoGatedUntilNoNotBefore() public {
    uint64 yesGate = uint64(block.timestamp + 1 days);
    uint64 noGate = uint64(block.timestamp + 2 days);
    CompleteSetBinaryMarket gatedMarket = _deployMarketWithConfig(
      address(collateral),
      address(this),
      retainedMinter,
      resolver,
      18,
      yesGate,
      noGate
    );

    // Past the YES gate but before the NO gate: NO must still revert...
    vm.warp(yesGate);
    vm.prank(resolver);
    vm.expectRevert(
      abi.encodeWithSelector(CompleteSetBinaryMarket.TooEarlyToResolve.selector, noGate)
    );
    gatedMarket.resolve(MarketTypes.Side.No);

    // ...while YES is already permitted at the same instant.
    vm.prank(resolver);
    gatedMarket.resolve(MarketTypes.Side.Yes);
    assertEq(uint8(gatedMarket.status()), uint8(CompleteSetBinaryMarket.Status.Resolved));
  }

  function test_WinningSideRequiresResolution() public {
    vm.expectRevert(
      abi.encodeWithSelector(
        CompleteSetBinaryMarket.InvalidStatus.selector,
        CompleteSetBinaryMarket.Status.Trading,
        CompleteSetBinaryMarket.Status.Resolved
      )
    );
    market.winningSide();

    vm.prank(resolver);
    market.resolve(MarketTypes.Side.No);

    assertEq(uint256(market.winningSide()), uint256(MarketTypes.Side.No));
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

  function test_RejectsZeroAmountsAndRecipients() public {
    _fundAndApprove(trader, 100 * WAD);

    vm.prank(trader);
    vm.expectRevert(CompleteSetBinaryMarket.InvalidRecipient.selector);
    market.mintCompleteSets(address(0), 1 * WAD);

    vm.prank(trader);
    vm.expectRevert(CompleteSetBinaryMarket.InvalidAmount.selector);
    market.mintCompleteSets(trader, 0);

    vm.prank(trader);
    vm.expectRevert(CompleteSetBinaryMarket.InvalidAmount.selector);
    market.mergeCompleteSets(0);

    vm.prank(retainedMinter);
    vm.expectRevert(CompleteSetBinaryMarket.InvalidAmount.selector);
    market.fundRetainedCollateral(0);

    vm.prank(retainedMinter);
    vm.expectRevert(CompleteSetBinaryMarket.InvalidRecipient.selector);
    market.mintRetainedSide(address(0), MarketTypes.Side.Yes, 1 * WAD);

    vm.prank(retainedMinter);
    vm.expectRevert(CompleteSetBinaryMarket.InvalidAmount.selector);
    market.mintRetainedSide(alice, MarketTypes.Side.Yes, 0);

    _mintCompleteSets(trader, 10 * WAD);
    vm.prank(resolver);
    market.resolve(MarketTypes.Side.Yes);

    vm.prank(trader);
    vm.expectRevert(CompleteSetBinaryMarket.InvalidAmount.selector);
    market.redeem(MarketTypes.Side.Yes, 0);
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
        CompleteSetBinaryMarket.InsolventOutcomeBacking.selector,
        100 * WAD,
        101 * WAD
      )
    );
    market.mintRetainedSide(alice, MarketTypes.Side.Yes, 1 * WAD);
    vm.stopPrank();

    assertEq(yesToken.totalSupply(), 100 * WAD);
  }

  function test_RetainedResolutionPaysOnlyWinningSupply() public {
    _fundRetainedMinter(100 * WAD);

    vm.startPrank(retainedMinter);
    market.fundRetainedCollateral(100 * WAD);
    market.mintRetainedSide(alice, MarketTypes.Side.Yes, 60 * WAD);
    market.mintRetainedSide(bob, MarketTypes.Side.No, 40 * WAD);
    vm.stopPrank();

    vm.prank(resolver);
    market.resolve(MarketTypes.Side.Yes);

    vm.prank(alice);
    uint256 collateralAmount = market.redeem(MarketTypes.Side.Yes, 60 * WAD);

    assertEq(collateralAmount, 60 * WAD);
    assertEq(collateral.balanceOf(alice), 60 * WAD);
    assertEq(collateral.balanceOf(address(market)), 40 * WAD);
    assertEq(yesToken.totalSupply(), 0);
    assertEq(noToken.totalSupply(), 40 * WAD);

    vm.prank(bob);
    vm.expectRevert(
      abi.encodeWithSelector(
        CompleteSetBinaryMarket.LosingSideCannotRedeem.selector,
        MarketTypes.Side.No,
        MarketTypes.Side.Yes
      )
    );
    market.redeem(MarketTypes.Side.No, 40 * WAD);
  }

  function test_CancelledAsymmetricRetainedSupplyPaysHalfOutstandingTokens() public {
    _fundRetainedMinter(100 * WAD);

    vm.startPrank(retainedMinter);
    market.fundRetainedCollateral(100 * WAD);
    market.mintRetainedSide(alice, MarketTypes.Side.Yes, 60 * WAD);
    market.mintRetainedSide(bob, MarketTypes.Side.No, 40 * WAD);
    vm.stopPrank();

    vm.prank(resolver);
    market.cancel();

    vm.prank(alice);
    uint256 yesCollateral = market.redeemCancelled(60 * WAD, 0);

    vm.prank(bob);
    uint256 noCollateral = market.redeemCancelled(0, 40 * WAD);

    assertEq(yesCollateral, 30 * WAD);
    assertEq(noCollateral, 20 * WAD);
    assertEq(collateral.balanceOf(alice), 30 * WAD);
    assertEq(collateral.balanceOf(bob), 20 * WAD);
    assertEq(collateral.balanceOf(address(market)), 50 * WAD);
    assertEq(yesToken.totalSupply(), 0);
    assertEq(noToken.totalSupply(), 0);
  }

  function test_OnlyRetainedMinterCanFundAndMintRetainedClaims() public {
    _fundAndApprove(trader, 100 * WAD);

    vm.prank(trader);
    vm.expectRevert(
      abi.encodeWithSelector(CompleteSetBinaryMarket.UnauthorizedRetainedMinter.selector, trader)
    );
    market.fundRetainedCollateral(100 * WAD);

    vm.prank(trader);
    vm.expectRevert(
      abi.encodeWithSelector(CompleteSetBinaryMarket.UnauthorizedRetainedMinter.selector, trader)
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
        CompleteSetBinaryMarket.LosingSideCannotRedeem.selector,
        MarketTypes.Side.No,
        MarketTypes.Side.Yes
      )
    );
    market.redeem(MarketTypes.Side.No, 1 * WAD);
  }

  function test_OnlyResolverCanResolveOrCancel() public {
    vm.prank(trader);
    vm.expectRevert(
      abi.encodeWithSelector(CompleteSetBinaryMarket.UnauthorizedResolver.selector, trader)
    );
    market.resolve(MarketTypes.Side.Yes);

    vm.prank(trader);
    vm.expectRevert(
      abi.encodeWithSelector(CompleteSetBinaryMarket.UnauthorizedResolver.selector, trader)
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
        CompleteSetBinaryMarket.InvalidStatus.selector,
        CompleteSetBinaryMarket.Status.Resolved,
        CompleteSetBinaryMarket.Status.Trading
      )
    );
    market.mergeCompleteSets(1 * WAD);
  }

  function test_TradingActionsAndCancellationAreUnavailableAfterResolution() public {
    _mintCompleteSets(trader, 100 * WAD);

    vm.prank(resolver);
    market.resolve(MarketTypes.Side.Yes);

    vm.prank(trader);
    vm.expectRevert(
      abi.encodeWithSelector(
        CompleteSetBinaryMarket.InvalidStatus.selector,
        CompleteSetBinaryMarket.Status.Resolved,
        CompleteSetBinaryMarket.Status.Trading
      )
    );
    market.mintCompleteSets(trader, 1 * WAD);

    vm.prank(retainedMinter);
    vm.expectRevert(
      abi.encodeWithSelector(
        CompleteSetBinaryMarket.InvalidStatus.selector,
        CompleteSetBinaryMarket.Status.Resolved,
        CompleteSetBinaryMarket.Status.Trading
      )
    );
    market.fundRetainedCollateral(1 * WAD);

    vm.prank(retainedMinter);
    vm.expectRevert(
      abi.encodeWithSelector(
        CompleteSetBinaryMarket.InvalidStatus.selector,
        CompleteSetBinaryMarket.Status.Resolved,
        CompleteSetBinaryMarket.Status.Trading
      )
    );
    market.mintRetainedSide(alice, MarketTypes.Side.Yes, 1 * WAD);

    vm.prank(resolver);
    vm.expectRevert(
      abi.encodeWithSelector(
        CompleteSetBinaryMarket.InvalidStatus.selector,
        CompleteSetBinaryMarket.Status.Resolved,
        CompleteSetBinaryMarket.Status.Trading
      )
    );
    market.cancel();

    vm.prank(trader);
    vm.expectRevert(
      abi.encodeWithSelector(
        CompleteSetBinaryMarket.InvalidStatus.selector,
        CompleteSetBinaryMarket.Status.Resolved,
        CompleteSetBinaryMarket.Status.Cancelled
      )
    );
    market.redeemCancelled(1 * WAD, 0);
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
    CompleteSetBinaryMarket sixDecimalMarket = _deployMarket(address(sixDecimalCollateral), 18);
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
    CompleteSetBinaryMarket sixDecimalMarket = _deployMarket(address(sixDecimalCollateral), 18);

    vm.expectRevert(
      abi.encodeWithSelector(CompleteSetBinaryMarket.AmountHasDust.selector, 1, 1e12)
    );
    sixDecimalMarket.collateralAmountForOutcome(1);
  }

  function test_SixDecimalCancellationRejectsSingleSideHalfUnitDust() public {
    SixDecimalCollateral sixDecimalCollateral = new SixDecimalCollateral();
    CompleteSetBinaryMarket sixDecimalMarket = _deployMarket(address(sixDecimalCollateral), 18);
    OutcomeToken sixDecimalYes = sixDecimalMarket.yesToken();
    OutcomeToken sixDecimalNo = sixDecimalMarket.noToken();

    sixDecimalCollateral.mint(trader, 1);
    vm.prank(trader);
    sixDecimalCollateral.approve(address(sixDecimalMarket), 1);

    vm.prank(trader);
    uint256 outcomeAmount = sixDecimalMarket.mintCompleteSets(trader, 1);

    vm.prank(resolver);
    sixDecimalMarket.cancel();

    vm.prank(trader);
    vm.expectRevert(CompleteSetBinaryMarket.InvalidAmount.selector);
    sixDecimalMarket.redeemCancelled(outcomeAmount, 0);

    vm.prank(trader);
    uint256 collateralAmount = sixDecimalMarket.redeemCancelled(outcomeAmount, outcomeAmount);

    assertEq(outcomeAmount, 1e12);
    assertEq(collateralAmount, 1);
    assertEq(sixDecimalCollateral.balanceOf(trader), 1);
    assertEq(sixDecimalCollateral.balanceOf(address(sixDecimalMarket)), 0);
    assertEq(sixDecimalYes.totalSupply(), 0);
    assertEq(sixDecimalNo.totalSupply(), 0);
  }

  function test_FeeOnTransferCollateralIsRejected() public {
    MockFeeCollateral feeCollateral = new MockFeeCollateral();
    CompleteSetBinaryMarket feeMarket = _deployMarket(address(feeCollateral), 18);
    feeCollateral.mint(trader, 100 * WAD);

    vm.prank(trader);
    feeCollateral.approve(address(feeMarket), 100 * WAD);

    vm.prank(trader);
    vm.expectRevert(
      abi.encodeWithSelector(
        CompleteSetBinaryMarket.InvalidCollateralTransfer.selector,
        100 * WAD,
        99 * WAD
      )
    );
    feeMarket.mintCompleteSets(trader, 100 * WAD);
  }

  function _deployMarket(
    address collateralToken,
    uint8 outcomeDecimals
  ) private returns (CompleteSetBinaryMarket) {
    return
      _deployMarketWithConfig(
        collateralToken,
        address(this),
        retainedMinter,
        resolver,
        outcomeDecimals,
        uint64(block.timestamp),
        uint64(block.timestamp)
      );
  }

  function _deployMarketWithConfig(
    address collateralToken,
    address owner,
    address retainedMinter_,
    address resolver_,
    uint8 outcomeDecimals,
    uint64 yesNotBefore,
    uint64 noNotBefore
  ) private returns (CompleteSetBinaryMarket) {
    return
      new CompleteSetBinaryMarket({
        collateralToken_: collateralToken,
        owner_: owner,
        retainedMinter_: retainedMinter_,
        resolver_: resolver_,
        marketName_: "Pop Charts Test",
        marketSymbol_: "PCT",
        outcomeDecimals_: outcomeDecimals,
        yesNotBefore_: yesNotBefore,
        noNotBefore_: noNotBefore
      });
  }

  function _fundAndApprove(address account, uint256 amount) private {
    _fundAndApprove(account, address(market), amount, amount);
  }

  function _fundRetainedMinter(uint256 amount) private {
    _fundAndApprove(retainedMinter, address(market), amount, amount);
  }

  function _mintCompleteSets(address account, uint256 collateralAmount) private {
    _fundAndApprove(account, collateralAmount);
    vm.prank(account);
    market.mintCompleteSets(account, collateralAmount);
  }
}
