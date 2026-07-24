// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {CompleteSetBinaryMarket} from "../../contracts/postgrad/CompleteSetBinaryMarket.sol";
import {CompleteSetPostgradAdapter} from "../../contracts/postgrad/CompleteSetPostgradAdapter.sol";
import {MarketTypes} from "../../contracts/types/MarketTypes.sol";
import {BaseTest} from "./BaseTest.sol";

/// Coverage for the optimistic two-step resolution flow (protocol ADR 0013,
/// first slice): propose opens a public window, finalize is permissionless
/// after it closes. The legacy zero-window direct-resolve path stays covered
/// by CompleteSetBinaryMarket.t.sol; dispute() and bond custody ship in the
/// next slice with their own suite.
contract CompleteSetBinaryMarketProposeTest is BaseTest {
  uint64 private constant WINDOW = 1 days;
  uint256 private constant BOND = 100e18;

  address private trader = makeAddr("trader");
  address private marketOwner = makeAddr("market-owner");
  address private retainedMinter = makeAddr("retained-minter");
  address private resolver = makeAddr("resolver");

  CompleteSetBinaryMarket private market;

  function setUp() public override {
    super.setUp();
    market = _deployWindowedMarket(WINDOW, uint64(block.timestamp), uint64(block.timestamp));
  }

  function test_ProposeRecordsProposalAndOpensWindow() public {
    uint64 expectedDeadline = uint64(block.timestamp) + WINDOW;
    vm.prank(resolver);
    vm.expectEmit(true, false, false, true, address(market));
    emit CompleteSetBinaryMarket.ResolutionProposed(MarketTypes.Side.Yes, expectedDeadline);
    market.proposeResolution(MarketTypes.Side.Yes);

    assertEq(uint8(market.status()), uint8(CompleteSetBinaryMarket.Status.ResolutionPending));
    assertEq(uint8(market.proposedSide()), uint8(MarketTypes.Side.Yes));
    assertEq(market.proposedAt(), uint64(block.timestamp));
    assertEq(market.disputeDeadline(), expectedDeadline);
  }

  function test_ProposeRespectsPerSideGatesAndResolverRole() public {
    uint64 gate = uint64(block.timestamp + 3 days);
    CompleteSetBinaryMarket gated = _deployWindowedMarket(WINDOW, gate, gate);

    vm.prank(resolver);
    vm.expectRevert(
      abi.encodeWithSelector(CompleteSetBinaryMarket.TooEarlyToResolve.selector, gate)
    );
    gated.proposeResolution(MarketTypes.Side.Yes);

    vm.expectRevert(
      abi.encodeWithSelector(CompleteSetBinaryMarket.UnauthorizedResolver.selector, address(this))
    );
    gated.proposeResolution(MarketTypes.Side.Yes);
  }

  function test_DirectResolveRevertsWhileWindowConfigured() public {
    vm.prank(resolver);
    vm.expectRevert(CompleteSetBinaryMarket.MarketNotDirectlyResolvable.selector);
    market.resolve(MarketTypes.Side.Yes);
  }

  function test_ProposalGettersRevertBeforeAnyProposal() public {
    // The dispute slice widened these getters to read during Disputed too,
    // so they raise the multi-status InvalidStatusForAction.
    vm.expectRevert(
      abi.encodeWithSelector(
        CompleteSetBinaryMarket.InvalidStatusForAction.selector,
        CompleteSetBinaryMarket.Status.Trading
      )
    );
    market.proposedSide();

    vm.expectRevert(
      abi.encodeWithSelector(
        CompleteSetBinaryMarket.InvalidStatusForAction.selector,
        CompleteSetBinaryMarket.Status.Trading
      )
    );
    market.disputeDeadline();
  }

  function test_FinalizeRevertsInsideWindowAndSucceedsAfter() public {
    vm.prank(resolver);
    market.proposeResolution(MarketTypes.Side.Yes);
    uint64 deadline = market.disputeDeadline();

    vm.expectRevert(
      abi.encodeWithSelector(CompleteSetBinaryMarket.DisputeWindowStillOpen.selector, deadline)
    );
    market.finalizeResolution();

    vm.warp(deadline);
    // Permissionless: an unrelated account finalizes.
    vm.prank(trader);
    vm.expectEmit(true, false, false, false, address(market));
    emit CompleteSetBinaryMarket.MarketResolved(MarketTypes.Side.Yes);
    market.finalizeResolution();

    assertEq(uint8(market.status()), uint8(CompleteSetBinaryMarket.Status.Resolved));
    assertEq(uint8(market.winningSide()), uint8(MarketTypes.Side.Yes));
  }

  function test_WinnersRedeemAfterFinalize() public {
    _fundAndApprove(trader, address(market), 10e18, 10e18);
    vm.prank(trader);
    market.mintCompleteSets(trader, 10e18);

    vm.prank(resolver);
    market.proposeResolution(MarketTypes.Side.Yes);
    vm.warp(market.disputeDeadline());
    market.finalizeResolution();

    vm.startPrank(trader);
    market.yesToken().approve(address(market), 10e18);
    uint256 paid = market.redeem(MarketTypes.Side.Yes, 10e18);
    vm.stopPrank();
    assertEq(paid, 10e18);
    assertEq(collateral.balanceOf(trader), 10e18);
  }

  function test_TradingStaysOpenWhilePending() public {
    vm.prank(resolver);
    market.proposeResolution(MarketTypes.Side.Yes);

    _fundAndApprove(trader, address(market), 6e18, 6e18);
    vm.prank(trader);
    market.mintCompleteSets(trader, 6e18);

    vm.startPrank(trader);
    market.yesToken().approve(address(market), 2e18);
    market.noToken().approve(address(market), 2e18);
    uint256 returned = market.mergeCompleteSets(2e18);
    vm.stopPrank();
    assertEq(returned, 2e18);
  }

  function test_CancelFromPendingIsTheEscapeHatch() public {
    vm.prank(resolver);
    market.proposeResolution(MarketTypes.Side.Yes);
    vm.prank(resolver);
    market.cancel();
    assertEq(uint8(market.status()), uint8(CompleteSetBinaryMarket.Status.Cancelled));
  }

  function test_ZeroWindowProposalIsImmediatelyFinalizable() public {
    CompleteSetBinaryMarket instant = _deployWindowedMarket(
      0,
      uint64(block.timestamp),
      uint64(block.timestamp)
    );
    vm.prank(resolver);
    instant.proposeResolution(MarketTypes.Side.Yes);

    instant.finalizeResolution();
    assertEq(uint8(instant.status()), uint8(CompleteSetBinaryMarket.Status.Resolved));
  }

  function test_AdapterStampsAndRetunesDisputeConfig() public {
    CompleteSetPostgradAdapter adapter = new CompleteSetPostgradAdapter({
      pregradManager_: address(this),
      owner_: marketOwner,
      resolver_: resolver,
      outcomeDecimals_: 18,
      disputeWindow_: WINDOW,
      disputeBond_: BOND
    });
    assertEq(adapter.disputeWindow(), WINDOW);
    assertEq(adapter.disputeBond(), BOND);

    vm.prank(marketOwner);
    vm.expectEmit(false, false, false, true, address(adapter));
    emit CompleteSetPostgradAdapter.DisputeConfigUpdated(2 * WINDOW, BOND / 2);
    adapter.setDisputeConfig(2 * WINDOW, BOND / 2);
    assertEq(adapter.disputeWindow(), 2 * WINDOW);
    assertEq(adapter.disputeBond(), BOND / 2);

    vm.expectRevert();
    adapter.setDisputeConfig(0, 0);
  }

  function _deployWindowedMarket(
    uint64 window,
    uint64 yesGate,
    uint64 noGate
  ) private returns (CompleteSetBinaryMarket) {
    return
      new CompleteSetBinaryMarket({
        collateralToken_: address(collateral),
        owner_: marketOwner,
        retainedMinter_: retainedMinter,
        resolver_: resolver,
        marketName_: "Pop Charts Propose Test",
        marketSymbol_: "PCP",
        outcomeDecimals_: 18,
        resolutionConfig_: CompleteSetBinaryMarket.ResolutionConfig({
          yesNotBefore: yesGate,
          noNotBefore: noGate,
          disputeWindow: window,
          disputeBond: BOND
        })
      });
  }
}
