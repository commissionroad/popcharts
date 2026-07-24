// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {CompleteSetBinaryMarket} from "../../contracts/postgrad/CompleteSetBinaryMarket.sol";
import {MarketTypes} from "../../contracts/types/MarketTypes.sol";
import {BaseTest} from "./BaseTest.sol";

/// Status-machine, bond-custody, and window-timing coverage for the bonded
/// optimistic resolution flow (protocol ADR 0013). The legacy zero-window
/// direct-resolve path stays covered by CompleteSetBinaryMarket.t.sol; this
/// suite exercises markets deployed with a real dispute window.
contract CompleteSetBinaryMarketDisputeTest is BaseTest {
  uint64 private constant WINDOW = 1 days;
  uint256 private constant BOND = 100e18;

  address private trader = makeAddr("trader");
  address private challenger = makeAddr("challenger");
  address private marketOwner = makeAddr("market-owner");
  address private retainedMinter = makeAddr("retained-minter");
  address private resolver = makeAddr("resolver");

  CompleteSetBinaryMarket private market;

  function setUp() public override {
    super.setUp();
    market = _deployDisputeMarket(WINDOW, BOND);
  }

  // ---------------------------------------------------------------- propose

  // --------------------------------------------------------------- finalize

  // ---------------------------------------------------------------- dispute

  function test_DisputeBondsCollateralAndFreezesFinalization() public {
    vm.prank(resolver);
    market.proposeResolution(MarketTypes.Side.Yes);

    _fundAndApprove(challenger, address(market), BOND, BOND);
    vm.prank(challenger);
    vm.expectEmit(true, false, false, true, address(market));
    emit CompleteSetBinaryMarket.DisputeBondPosted(challenger, BOND);
    vm.expectEmit(true, false, false, true, address(market));
    emit CompleteSetBinaryMarket.ResolutionDisputed(challenger, BOND);
    market.dispute();

    assertEq(uint8(market.status()), uint8(CompleteSetBinaryMarket.Status.Disputed));
    assertEq(market.disputer(), challenger);
    assertEq(market.disputeBondHeld(), BOND);
    assertEq(collateral.balanceOf(challenger), 0);

    // A frozen market can neither finalize nor accept a second dispute.
    vm.expectRevert(
      abi.encodeWithSelector(
        CompleteSetBinaryMarket.InvalidStatus.selector,
        CompleteSetBinaryMarket.Status.Disputed,
        CompleteSetBinaryMarket.Status.ResolutionPending
      )
    );
    market.finalizeResolution();
    vm.prank(trader);
    vm.expectRevert(
      abi.encodeWithSelector(
        CompleteSetBinaryMarket.InvalidStatus.selector,
        CompleteSetBinaryMarket.Status.Disputed,
        CompleteSetBinaryMarket.Status.ResolutionPending
      )
    );
    market.dispute();
  }

  function test_DisputeRevertsAtOrAfterDeadline() public {
    vm.prank(resolver);
    market.proposeResolution(MarketTypes.Side.Yes);
    uint64 deadline = market.disputeDeadline();

    vm.warp(deadline);
    _fundAndApprove(challenger, address(market), BOND, BOND);
    vm.prank(challenger);
    vm.expectRevert(
      abi.encodeWithSelector(CompleteSetBinaryMarket.DisputeWindowClosed.selector, deadline)
    );
    market.dispute();
  }

  function test_ResolverSelfDisputeIsBondFree() public {
    vm.prank(resolver);
    market.proposeResolution(MarketTypes.Side.Yes);

    vm.prank(resolver);
    vm.expectEmit(true, false, false, true, address(market));
    emit CompleteSetBinaryMarket.ResolutionDisputed(resolver, 0);
    market.dispute();

    assertEq(uint8(market.status()), uint8(CompleteSetBinaryMarket.Status.Disputed));
    assertEq(market.disputer(), resolver);
    assertEq(market.disputeBondHeld(), 0);
  }

  // ------------------------------------------------------------- settlement

  function test_SettlementRefundsBondWhenOutcomeChanges() public {
    _proposeAndDispute(MarketTypes.Side.Yes);

    vm.prank(resolver);
    vm.expectEmit(true, false, false, true, address(market));
    emit CompleteSetBinaryMarket.DisputeBondRefunded(challenger, BOND);
    market.resolve(MarketTypes.Side.No);

    assertEq(uint8(market.status()), uint8(CompleteSetBinaryMarket.Status.Resolved));
    assertEq(uint8(market.winningSide()), uint8(MarketTypes.Side.No));
    assertEq(collateral.balanceOf(challenger), BOND);
    assertEq(market.disputeBondHeld(), 0);
  }

  function test_SettlementForfeitsBondToOwnerWhenOutcomeStands() public {
    _proposeAndDispute(MarketTypes.Side.Yes);

    vm.prank(resolver);
    vm.expectEmit(true, false, false, true, address(market));
    emit CompleteSetBinaryMarket.DisputeBondForfeited(challenger, BOND);
    market.resolve(MarketTypes.Side.Yes);

    assertEq(collateral.balanceOf(marketOwner), BOND);
    assertEq(collateral.balanceOf(challenger), 0);
    assertEq(market.disputeBondHeld(), 0);
  }

  function test_SettlementIgnoresTimeGates() public {
    uint64 gate = uint64(block.timestamp + 30 days);
    CompleteSetBinaryMarket gated = _deployDisputeMarketWithGates(
      WINDOW,
      BOND,
      uint64(block.timestamp),
      gate
    );

    vm.prank(resolver);
    gated.proposeResolution(MarketTypes.Side.Yes);
    vm.prank(resolver);
    gated.dispute();

    // NO is normally gated until `gate`; dispute settlement is a human
    // adjudication and bypasses the per-side floors.
    vm.prank(resolver);
    gated.resolve(MarketTypes.Side.No);
    assertEq(uint8(gated.winningSide()), uint8(MarketTypes.Side.No));
  }

  function test_ResolveFromPendingReverts() public {
    vm.prank(resolver);
    market.proposeResolution(MarketTypes.Side.Yes);

    vm.prank(resolver);
    vm.expectRevert(
      abi.encodeWithSelector(
        CompleteSetBinaryMarket.InvalidStatus.selector,
        CompleteSetBinaryMarket.Status.ResolutionPending,
        CompleteSetBinaryMarket.Status.Disputed
      )
    );
    market.resolve(MarketTypes.Side.Yes);
  }

  function test_CancelFromDisputedRefundsBond() public {
    _proposeAndDispute(MarketTypes.Side.No);

    vm.prank(resolver);
    vm.expectEmit(true, false, false, true, address(market));
    emit CompleteSetBinaryMarket.DisputeBondRefunded(challenger, BOND);
    market.cancel();
    assertEq(uint8(market.status()), uint8(CompleteSetBinaryMarket.Status.Cancelled));
    assertEq(collateral.balanceOf(challenger), BOND);
  }

  // ----------------------------------------------------------- bond custody

  function test_BondEscrowNeverCountsTowardRedemptionCapacity() public {
    _fundAndApprove(trader, address(market), 10e18, 10e18);
    vm.prank(trader);
    market.mintCompleteSets(trader, 10e18);

    _proposeAndDispute(MarketTypes.Side.Yes);

    // With the bond escrowed, reported capacity still reflects only market
    // collateral: 10e18 backing, not 10e18 + BOND.
    assertEq(market.collateralOutcomeCapacity(), 10e18);

    // Forfeit the bond, then every winning token still redeems exactly 1:1.
    vm.prank(resolver);
    market.resolve(MarketTypes.Side.Yes);
    vm.startPrank(trader);
    market.yesToken().approve(address(market), 10e18);
    uint256 paid = market.redeem(MarketTypes.Side.Yes, 10e18);
    vm.stopPrank();
    assertEq(paid, 10e18);
  }

  function test_TradingStaysOpenWhilePendingAndDisputed() public {
    vm.prank(resolver);
    market.proposeResolution(MarketTypes.Side.Yes);

    _fundAndApprove(trader, address(market), 6e18, 6e18);
    vm.prank(trader);
    market.mintCompleteSets(trader, 6e18);

    _fundAndApprove(challenger, address(market), BOND, BOND);
    vm.prank(challenger);
    market.dispute();

    // Merge works during the dispute and pays from market collateral, with
    // the bond untouched.
    vm.startPrank(trader);
    market.yesToken().approve(address(market), 2e18);
    market.noToken().approve(address(market), 2e18);
    uint256 returned = market.mergeCompleteSets(2e18);
    vm.stopPrank();
    assertEq(returned, 2e18);
    assertEq(market.disputeBondHeld(), BOND);
  }

  // -------------------------------------------------------- zero-bond/window

  function test_ZeroBondDisputeRecordsDisputerWithoutTransfer() public {
    CompleteSetBinaryMarket freeDispute = _deployDisputeMarketWithBond(WINDOW, 0);
    vm.prank(resolver);
    freeDispute.proposeResolution(MarketTypes.Side.Yes);

    vm.prank(challenger);
    vm.expectEmit(true, false, false, true, address(freeDispute));
    emit CompleteSetBinaryMarket.ResolutionDisputed(challenger, 0);
    freeDispute.dispute();
    assertEq(freeDispute.disputeBondHeld(), 0);
  }

  function test_ZeroWindowRejectsDisputesImmediately() public {
    CompleteSetBinaryMarket instant = _deployDisputeMarketWithBond(0, BOND);
    vm.prank(resolver);
    instant.proposeResolution(MarketTypes.Side.Yes);

    // The window is already closed at proposal time, so the market can never
    // be disputed — the documented zero-window degeneration.
    vm.prank(challenger);
    vm.expectRevert(
      abi.encodeWithSelector(
        CompleteSetBinaryMarket.DisputeWindowClosed.selector,
        instant.disputeDeadline()
      )
    );
    instant.dispute();
  }

  function test_ProposalGettersReadableWhileDisputed() public {
    _proposeAndDispute(MarketTypes.Side.Yes);
    assertEq(uint8(market.proposedSide()), uint8(MarketTypes.Side.Yes));
    assertEq(market.disputeDeadline(), market.proposedAt() + WINDOW);
  }

  // ---------------------------------------------------------------- adapter

  // ---------------------------------------------------------------- helpers

  function _proposeAndDispute(MarketTypes.Side side) private {
    vm.prank(resolver);
    market.proposeResolution(side);
    _fundAndApprove(challenger, address(market), BOND, BOND);
    vm.prank(challenger);
    market.dispute();
  }

  function _deployDisputeMarket(
    uint64 window,
    uint256 bond
  ) private returns (CompleteSetBinaryMarket) {
    return
      _deployDisputeMarketWithGates(window, bond, uint64(block.timestamp), uint64(block.timestamp));
  }

  function _deployDisputeMarketWithBond(
    uint64 window,
    uint256 bond
  ) private returns (CompleteSetBinaryMarket) {
    return
      _deployDisputeMarketWithGates(window, bond, uint64(block.timestamp), uint64(block.timestamp));
  }

  function _deployDisputeMarketWithGates(
    uint64 window,
    uint256 bond,
    uint64 yesGate,
    uint64 noGate
  ) private returns (CompleteSetBinaryMarket) {
    return
      new CompleteSetBinaryMarket({
        collateralToken_: address(collateral),
        owner_: marketOwner,
        retainedMinter_: retainedMinter,
        resolver_: resolver,
        marketName_: "Pop Charts Dispute Test",
        marketSymbol_: "PCD",
        outcomeDecimals_: 18,
        resolutionConfig_: CompleteSetBinaryMarket.ResolutionConfig({
          yesNotBefore: yesGate,
          noNotBefore: noGate,
          disputeWindow: window,
          disputeBond: bond
        })
      });
  }
}
