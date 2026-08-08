// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IProtocolFees} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IProtocolFees.sol";
import {CompleteSetBinaryMarket} from "../../contracts/postgrad/CompleteSetBinaryMarket.sol";
import {OutcomeToken} from "../../contracts/postgrad/OutcomeToken.sol";
import {
  ICompleteSetMergeMarket,
  PostgradFeeController
} from "../../contracts/v4/PostgradFeeController.sol";
import {MarketTypes} from "../../contracts/types/MarketTypes.sol";
import {BaseTest} from "./BaseTest.sol";
import {SixDecimalCollateral} from "./mocks/SixDecimalCollateral.sol";

/// Outcome-token fee policy against the real complete-set market: swept
/// YES/NO fee holdings pair as min(yes, no), merge back to collateral paid to
/// the controller, and the unpaired remainder (plus merged collateral) leaves
/// only through the evented owner withdrawal. Venue-side accrual and sweeping
/// run in PostgradFeeControllerVenue.t.sol — the pool manager's compilation
/// closure pins solidity 0.8.26 exactly while this market needs ^0.8.28, so
/// one suite cannot hold both.
contract PostgradFeeControllerMergeTest is BaseTest {
  address private trader = makeAddr("trader");
  address private retainedMinter = makeAddr("retained-minter");
  address private resolver = makeAddr("resolver");
  address private treasury = makeAddr("treasury");
  address private stranger = makeAddr("stranger");

  CompleteSetBinaryMarket private market;
  OutcomeToken private yesToken;
  OutcomeToken private noToken;
  PostgradFeeController private controller;

  function setUp() public override {
    super.setUp();
    market = _deployMarket(address(collateral));
    yesToken = market.yesToken();
    noToken = market.noToken();
    // The merge path never touches the venue, so any nonzero pool manager
    // address satisfies the constructor here.
    controller = new PostgradFeeController(
      IProtocolFees(makeAddr("venue-pool-manager")),
      address(this)
    );
  }

  function test_MergeOutcomeFeesPairsMinAndReceivesCollateral() public {
    _placeSweptOutcomeFees(30 * WAD, 20 * WAD);

    vm.expectEmit(true, true, true, true, address(controller));
    emit PostgradFeeController.OutcomeFeesMerged(address(market), 20 * WAD, 20 * WAD);
    (uint256 outcomeAmount, uint256 collateralAmount) = controller.mergeOutcomeFees(
      ICompleteSetMergeMarket(address(market))
    );

    assertEq(outcomeAmount, 20 * WAD);
    assertEq(collateralAmount, 20 * WAD);
    assertEq(collateral.balanceOf(address(controller)), 20 * WAD);
    assertEq(yesToken.balanceOf(address(controller)), 10 * WAD);
    assertEq(noToken.balanceOf(address(controller)), 0);
  }

  function test_MergeOutcomeFeesFloorsPairToConversionGrid() public {
    // 6-decimal collateral under 18-decimal outcomes: the market only merges
    // outcome amounts divisible by 1e12, so the pair floors to that grid and
    // the sub-grid dust stays behind for a later, larger merge.
    (
      CompleteSetBinaryMarket sixDecimalMarket,
      SixDecimalCollateral sixDecimalCollateral
    ) = _deploySixDecimalMarket();
    uint256 conversionFactor = 10 ** 12;
    uint256 yesAmount = 2 * conversionFactor + 5;
    uint256 noAmount = 9 * conversionFactor;
    vm.startPrank(trader);
    sixDecimalMarket.yesToken().transfer(address(controller), yesAmount);
    sixDecimalMarket.noToken().transfer(address(controller), noAmount);
    vm.stopPrank();

    (uint256 outcomeAmount, uint256 collateralAmount) = controller.mergeOutcomeFees(
      ICompleteSetMergeMarket(address(sixDecimalMarket))
    );

    assertEq(outcomeAmount, 2 * conversionFactor);
    assertEq(collateralAmount, 2);
    assertEq(sixDecimalCollateral.balanceOf(address(controller)), 2);
    assertEq(sixDecimalMarket.yesToken().balanceOf(address(controller)), 5);
    assertEq(
      sixDecimalMarket.noToken().balanceOf(address(controller)),
      noAmount - 2 * conversionFactor
    );
  }

  function test_MergeOutcomeFeesRevertsWithNothingPairable() public {
    // One-sided holdings pair to zero.
    _placeSweptOutcomeFees(5 * WAD, 0);

    vm.expectRevert(
      abi.encodeWithSelector(PostgradFeeController.NoOutcomeFeesToMerge.selector, address(market))
    );
    controller.mergeOutcomeFees(ICompleteSetMergeMarket(address(market)));
  }

  function test_MergeOutcomeFeesRevertsWhenPairIsAllDust() public {
    (CompleteSetBinaryMarket sixDecimalMarket, ) = _deploySixDecimalMarket();
    vm.startPrank(trader);
    sixDecimalMarket.yesToken().transfer(address(controller), 7);
    sixDecimalMarket.noToken().transfer(address(controller), 9);
    vm.stopPrank();

    vm.expectRevert(
      abi.encodeWithSelector(
        PostgradFeeController.NoOutcomeFeesToMerge.selector,
        address(sixDecimalMarket)
      )
    );
    controller.mergeOutcomeFees(ICompleteSetMergeMarket(address(sixDecimalMarket)));
  }

  function test_MergeOutcomeFeesRevertsAfterResolution() public {
    // The merge window closes at resolution (the market gates it on a
    // non-terminal status) — which is why outcome-token fees must not sit.
    _placeSweptOutcomeFees(20 * WAD, 20 * WAD);
    vm.prank(resolver);
    market.resolve(MarketTypes.Side.Yes);

    vm.expectRevert(
      abi.encodeWithSelector(
        CompleteSetBinaryMarket.InvalidStatusForAction.selector,
        CompleteSetBinaryMarket.Status.Resolved
      )
    );
    controller.mergeOutcomeFees(ICompleteSetMergeMarket(address(market)));
  }

  function test_WithdrawFeeTokensMovesRemainderAndMergedCollateral() public {
    _placeSweptOutcomeFees(30 * WAD, 20 * WAD);
    controller.mergeOutcomeFees(ICompleteSetMergeMarket(address(market)));

    vm.expectEmit(true, true, true, true, address(controller));
    emit PostgradFeeController.FeeTokensWithdrawn(address(yesToken), treasury, 10 * WAD);
    controller.withdrawFeeTokens(yesToken, treasury, 10 * WAD);

    vm.expectEmit(true, true, true, true, address(controller));
    emit PostgradFeeController.FeeTokensWithdrawn(address(collateral), treasury, 20 * WAD);
    controller.withdrawFeeTokens(collateral, treasury, 20 * WAD);

    assertEq(yesToken.balanceOf(treasury), 10 * WAD);
    assertEq(collateral.balanceOf(treasury), 20 * WAD);
    assertEq(yesToken.balanceOf(address(controller)), 0);
    assertEq(collateral.balanceOf(address(controller)), 0);
  }

  function test_WithdrawFeeTokensRejectsZeroRecipientAndZeroAmount() public {
    vm.expectRevert(PostgradFeeController.InvalidFeeRecipient.selector);
    controller.withdrawFeeTokens(collateral, address(0), 1);

    vm.expectRevert(PostgradFeeController.InvalidWithdrawalAmount.selector);
    controller.withdrawFeeTokens(collateral, treasury, 0);
  }

  function test_OnlyOwnerGatesMergeAndWithdraw() public {
    bytes memory unauthorized = abi.encodeWithSelector(
      Ownable.OwnableUnauthorizedAccount.selector,
      stranger
    );

    vm.startPrank(stranger);
    vm.expectRevert(unauthorized);
    controller.mergeOutcomeFees(ICompleteSetMergeMarket(address(market)));
    vm.expectRevert(unauthorized);
    controller.withdrawFeeTokens(collateral, treasury, 1);
    vm.stopPrank();
  }

  /// Mints complete sets to the trader and moves the requested YES/NO amounts
  /// into the controller, standing in for outcome-token fees swept from the
  /// venue.
  function _placeSweptOutcomeFees(uint256 yesAmount, uint256 noAmount) private {
    uint256 setSize = yesAmount > noAmount ? yesAmount : noAmount;
    _fundAndApprove(trader, address(market), setSize, setSize);
    vm.startPrank(trader);
    market.mintCompleteSets(trader, setSize);
    if (yesAmount > 0) {
      yesToken.transfer(address(controller), yesAmount);
    }
    if (noAmount > 0) {
      noToken.transfer(address(controller), noAmount);
    }
    vm.stopPrank();
  }

  function _deploySixDecimalMarket()
    private
    returns (CompleteSetBinaryMarket sixDecimalMarket, SixDecimalCollateral sixDecimalCollateral)
  {
    sixDecimalCollateral = new SixDecimalCollateral();
    sixDecimalMarket = _deployMarket(address(sixDecimalCollateral));

    uint256 mintCollateral = 100 * 10 ** 6;
    sixDecimalCollateral.mint(trader, mintCollateral);
    vm.startPrank(trader);
    sixDecimalCollateral.approve(address(sixDecimalMarket), mintCollateral);
    sixDecimalMarket.mintCompleteSets(trader, mintCollateral);
    vm.stopPrank();
  }

  function _deployMarket(address collateralToken) private returns (CompleteSetBinaryMarket) {
    return
      new CompleteSetBinaryMarket({
        collateralToken_: collateralToken,
        owner_: address(this),
        retainedMinter_: retainedMinter,
        resolver_: resolver,
        marketName_: "Pop Charts Test",
        marketSymbol_: "PCT",
        outcomeDecimals_: 18,
        resolutionConfig_: CompleteSetBinaryMarket.ResolutionConfig({
          yesNotBefore: uint64(block.timestamp),
          noNotBefore: uint64(block.timestamp),
          disputeWindow: 0,
          disputeBond: 0
        })
      });
  }
}
