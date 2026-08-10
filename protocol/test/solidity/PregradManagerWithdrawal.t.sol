// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PregradManager} from "../../contracts/PregradManager.sol";
import {ReceiptBook} from "../../contracts/ReceiptBook.sol";
import {ReceiptBands} from "../../contracts/libraries/ReceiptBands.sol";
import {MarketTypes} from "../../contracts/types/MarketTypes.sol";
import {LmsrMathHarness} from "./harnesses/LmsrMathHarness.sol";
import {BaseTest} from "./BaseTest.sol";

/// The ADR 0014 P3/P4b withdrawal mechanism: optimistic request, O(1)
/// refutation, at-or-after-deadline finalization, the freeze interaction, and
/// the withdrawal fee. Placement fixtures mirror PregradManagerTest's.
contract PregradManagerWithdrawalTest is BaseTest {
  uint256 private constant ONE_PERCENT_WAD = 1e16;
  uint256 private constant FIVE_PERCENT_WAD = 5e16;
  uint256 private constant DEFAULT_B = 5_000 * WAD;

  PregradManager private manager;
  LmsrMathHarness private lmsr;

  function setUp() public override {
    super.setUp();
    manager = _deployPregradManager();
    lmsr = new LmsrMathHarness();
  }

  // ------------------------------------------------------------ P4b: the rate

  function test_WithdrawalFeeRateDefaultsToZero() public view {
    assertEq(manager.withdrawalFeeRateWad(), 0);
    assertEq(manager.withdrawalFeeFor(100 * WAD), 0);
  }

  function test_SetWithdrawalFeeRateUpdatesAndEnforcesCap() public {
    vm.expectEmit(true, true, true, true, address(manager));
    emit PregradManager.WithdrawalFeeRateUpdated(0, FIVE_PERCENT_WAD);
    manager.setWithdrawalFeeRate(FIVE_PERCENT_WAD);
    assertEq(manager.withdrawalFeeRateWad(), FIVE_PERCENT_WAD);
    assertEq(manager.withdrawalFeeFor(100 * WAD), 5 * WAD);

    uint256 aboveCap = manager.MAX_WITHDRAWAL_FEE_RATE_WAD() + 1;
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.WithdrawalFeeRateExceedsMaximum.selector,
        aboveCap,
        manager.MAX_WITHDRAWAL_FEE_RATE_WAD()
      )
    );
    manager.setWithdrawalFeeRate(aboveCap);

    address notOwner = makeAddr("withdrawal-rate-stranger");
    vm.prank(notOwner);
    vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, notOwner));
    manager.setWithdrawalFeeRate(FIVE_PERCENT_WAD);
  }

  function test_SetWithdrawalChallengePeriodValidatesOwnerAndBounds() public {
    address notOwner = makeAddr("withdrawal-period-stranger");
    vm.prank(notOwner);
    vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, notOwner));
    manager.setWithdrawalChallengePeriod(5 minutes);

    uint64 tooLong = manager.MAX_WITHDRAWAL_CHALLENGE_PERIOD() + 1;
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidWithdrawalChallengePeriod.selector,
        tooLong,
        manager.MAX_WITHDRAWAL_CHALLENGE_PERIOD()
      )
    );
    manager.setWithdrawalChallengePeriod(tooLong);

    vm.expectEmit(true, true, true, true, address(manager));
    emit PregradManager.WithdrawalChallengePeriodUpdated(0, 5 minutes);
    manager.setWithdrawalChallengePeriod(5 minutes);

    assertEq(manager.withdrawalChallengePeriod(), 5 minutes);
  }

  // ----------------------------------------------------------- request gates

  function test_RequestValidatesManagerOwnerReceiptAndMarket() public {
    address buyer = makeAddr("gate-buyer");
    uint256 marketId = _createDefaultMarket();
    _fundAndApprove(buyer, 1_000 * WAD);
    (uint256 receiptId, ) = _placeReceiptAs(buyer, marketId, MarketTypes.Side.Yes, 100 * WAD);
    MarketTypes.PathSegment[] memory claim = manager.getReceiptSegments(receiptId);

    address stranger = makeAddr("request-stranger");
    vm.prank(stranger);
    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.UnauthorizedGraduationManager.selector, stranger)
    );
    manager.requestReceiptWithdrawal(receiptId, buyer, claim);

    vm.expectRevert(abi.encodeWithSelector(ReceiptBook.ReceiptDoesNotExist.selector, 99));
    manager.requestReceiptWithdrawal(99, buyer, claim);

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidWithdrawalOwner.selector,
        receiptId,
        stranger,
        buyer
      )
    );
    manager.requestReceiptWithdrawal(receiptId, stranger, claim);

    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.NoWithdrawalSegments.selector, receiptId)
    );
    manager.requestReceiptWithdrawal(receiptId, buyer, new MarketTypes.PathSegment[](0));

    // Past the graduation deadline the market is refund-bound; no requests.
    vm.warp(manager.getMarketConfig(marketId).graduationDeadline);
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.MarketPastGraduationDeadline.selector,
        marketId,
        manager.getMarketConfig(marketId).graduationDeadline
      )
    );
    manager.requestReceiptWithdrawal(receiptId, buyer, claim);
  }

  function test_RequestRevertsOnCancelledMarketAndSettledReceipt() public {
    address buyer = makeAddr("cancel-gate-buyer");
    uint256 marketId = _createDefaultMarket();
    _fundAndApprove(buyer, 1_000 * WAD);
    (uint256 receiptId, ) = _placeReceiptAs(buyer, marketId, MarketTypes.Side.No, 50 * WAD);
    MarketTypes.PathSegment[] memory claim = manager.getReceiptSegments(receiptId);

    manager.cancelMarket(marketId);
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidMarketStatus.selector,
        marketId,
        MarketTypes.MarketStatus.Cancelled,
        MarketTypes.MarketStatus.Active
      )
    );
    manager.requestReceiptWithdrawal(receiptId, buyer, claim);

    manager.claimRefundedReceipt(receiptId);
    vm.expectRevert(abi.encodeWithSelector(ReceiptBook.ReceiptAlreadyClaimed.selector, receiptId));
    manager.requestReceiptWithdrawal(receiptId, buyer, claim);
  }

  function test_RequestValidatesSegmentShape() public {
    address buyer = makeAddr("shape-buyer");
    uint256 marketId = _createDefaultMarket();
    _fundAndApprove(buyer, 1_000 * WAD);
    (uint256 receiptId, ) = _placeReceiptAs(buyer, marketId, MarketTypes.Side.Yes, 100 * WAD);

    // Unordered pair: the second segment starts before the first one ends.
    MarketTypes.PathSegment[] memory unordered = new MarketTypes.PathSegment[](2);
    unordered[0] = MarketTypes.PathSegment({rLow: 20 * int256(WAD), rHigh: 30 * int256(WAD)});
    unordered[1] = MarketTypes.PathSegment({rLow: 10 * int256(WAD), rHigh: 15 * int256(WAD)});
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.UnorderedWithdrawalSegments.selector,
        30 * int256(WAD),
        10 * int256(WAD)
      )
    );
    manager.requestReceiptWithdrawal(receiptId, buyer, unordered);

    // Inverted segment.
    vm.expectRevert(
      abi.encodeWithSelector(ReceiptBands.EmptyBand.selector, 5 * int256(WAD), 3 * int256(WAD))
    );
    manager.requestReceiptWithdrawal(receiptId, buyer, _segment(5 * int256(WAD), 3 * int256(WAD)));

    // Outside the live support.
    vm.expectRevert(
      abi.encodeWithSelector(
        ReceiptBands.BandOutsideLiveSupport.selector,
        -5 * int256(WAD),
        -1 * int256(WAD)
      )
    );
    manager.requestReceiptWithdrawal(
      receiptId,
      buyer,
      _segment(-5 * int256(WAD), -1 * int256(WAD))
    );

    // A band spanning a withdrawn gap: withdraw the middle first, then claim
    // across it.
    manager.requestReceiptWithdrawal(
      receiptId,
      buyer,
      _segment(40 * int256(WAD), 60 * int256(WAD))
    );
    manager.finalizeReceiptWithdrawal(1);
    vm.expectRevert(
      abi.encodeWithSelector(
        ReceiptBands.BandOutsideLiveSupport.selector,
        30 * int256(WAD),
        70 * int256(WAD)
      )
    );
    manager.requestReceiptWithdrawal(
      receiptId,
      buyer,
      _segment(30 * int256(WAD), 70 * int256(WAD))
    );
  }

  function test_OnePendingRequestPerReceipt() public {
    manager.setWithdrawalChallengePeriod(1 hours);
    address buyer = makeAddr("serial-buyer");
    uint256 marketId = _createDefaultMarket();
    _fundAndApprove(buyer, 1_000 * WAD);
    (uint256 receiptId, ) = _placeReceiptAs(buyer, marketId, MarketTypes.Side.Yes, 100 * WAD);

    uint256 requestId = manager.requestReceiptWithdrawal(
      receiptId,
      buyer,
      _segment(0, 10 * int256(WAD))
    );
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.WithdrawalRequestAlreadyPending.selector,
        receiptId,
        requestId
      )
    );
    manager.requestReceiptWithdrawal(
      receiptId,
      buyer,
      _segment(20 * int256(WAD), 30 * int256(WAD))
    );
  }

  // -------------------------------------------------------------- honest flow

  /// Threaded through the honest-flow phases: the test body plus two helper
  /// frames exist purely to dodge stack-too-deep under the non-viaIR test
  /// pipeline.
  struct HonestFlowFixture {
    address buyer;
    uint256 marketId;
    uint256 receiptId;
    uint256 cost;
    uint256 entryFeePaid;
    uint256 expectedFee;
    uint256 requestId;
  }

  function test_HonestFlowFullWithdrawalPaysExactAmounts() public {
    manager.setEntryFeeRate(ONE_PERCENT_WAD);
    manager.setWithdrawalFeeRate(FIVE_PERCENT_WAD);
    HonestFlowFixture memory fixture;
    fixture.buyer = makeAddr("honest-withdrawer");
    fixture.marketId = _createDefaultMarket();
    _fundAndApprove(fixture.buyer, 1_000 * WAD);
    (uint256 receiptId, MarketTypes.ReceiptQuote memory quote) = _placeReceiptAs(
      fixture.buyer,
      fixture.marketId,
      MarketTypes.Side.Yes,
      100 * WAD
    );
    fixture.receiptId = receiptId;
    fixture.cost = quote.cost;
    fixture.entryFeePaid = manager.getReceipt(receiptId).entryFeePaid;
    fixture.expectedFee = manager.withdrawalFeeFor(quote.cost);
    assertGt(fixture.entryFeePaid, 0);
    assertGt(fixture.expectedFee, 0);

    _honestFlowRequestPhase(fixture);
    _honestFlowFinalizePhase(fixture);
  }

  function _honestFlowRequestPhase(HonestFlowFixture memory fixture) private {
    MarketTypes.PathSegment[] memory claim = manager.getReceiptSegments(fixture.receiptId);

    // The full-interval claim prices at exactly the placement cost, and the
    // full entry fee returns with it: mulDiv(fee, cost, cost) == fee.
    vm.expectEmit(true, true, true, true, address(manager));
    emit PregradManager.ReceiptWithdrawalRequested(
      1,
      fixture.receiptId,
      fixture.marketId,
      fixture.buyer,
      claim,
      fixture.cost,
      fixture.expectedFee,
      fixture.entryFeePaid,
      uint64(block.timestamp),
      manager.nextReceiptId()
    );
    fixture.requestId = manager.requestReceiptWithdrawal(fixture.receiptId, fixture.buyer, claim);
    assertEq(fixture.requestId, 1);
    assertEq(manager.nextWithdrawalRequestId(), 2);
    assertEq(manager.pendingWithdrawalRequestOf(fixture.receiptId), fixture.requestId);
    assertEq(manager.marketPendingWithdrawals(fixture.marketId), 1);

    // Segments leave live support at request; money moves only at finalize.
    assertEq(manager.getReceiptSegments(fixture.receiptId).length, 0);
    assertEq(manager.getMarketState(fixture.marketId).totalEscrowed, fixture.cost);
    assertEq(collateral.balanceOf(address(manager)), fixture.cost + fixture.entryFeePaid);

    MarketTypes.WithdrawalRequest memory stored = manager.getWithdrawalRequest(fixture.requestId);
    assertEq(stored.grossRefund, fixture.cost);
    assertEq(stored.withdrawalFee, fixture.expectedFee);
    assertEq(stored.entryFeeRefund, fixture.entryFeePaid);
    assertEq(stored.owner, fixture.buyer);
    assertEq(uint8(stored.status), uint8(MarketTypes.WithdrawalRequestStatus.Pending));
  }

  function _honestFlowFinalizePhase(HonestFlowFixture memory fixture) private {
    uint256 buyerBalanceBefore = collateral.balanceOf(fixture.buyer);
    vm.expectEmit(true, true, true, true, address(manager));
    emit PregradManager.ReceiptWithdrawalFinalized(
      fixture.requestId,
      fixture.receiptId,
      fixture.marketId,
      fixture.buyer,
      fixture.cost - fixture.expectedFee,
      fixture.entryFeePaid,
      fixture.expectedFee
    );
    manager.finalizeReceiptWithdrawal(fixture.requestId);

    // The withdrawer pays exactly phi_out of what they take back: the escrow
    // comes home net of the fee and the never-earned entry fee comes with it.
    assertEq(
      collateral.balanceOf(fixture.buyer),
      buyerBalanceBefore + fixture.cost - fixture.expectedFee + fixture.entryFeePaid
    );

    MarketTypes.MarketState memory state = manager.getMarketState(fixture.marketId);
    assertEq(state.totalEscrowed, 0);
    assertEq(state.path, 0);
    assertEq(state.yesShares, 0);

    MarketTypes.Receipt memory receipt = manager.getReceipt(fixture.receiptId);
    assertEq(receipt.cost, 0);
    assertEq(receipt.shares, 0);
    assertEq(receipt.entryFeePaid, 0);
    assertTrue(receipt.active);

    assertEq(manager.marketEntryFeeEscrow(fixture.marketId), 0);
    assertEq(manager.marketWithdrawalFeesEarned(fixture.marketId), fixture.expectedFee);
    assertEq(manager.pendingWithdrawalRequestOf(fixture.receiptId), 0);
    assertEq(manager.marketPendingWithdrawals(fixture.marketId), 0);
    // The earned fee is the only value left in the contract.
    assertEq(collateral.balanceOf(address(manager)), fixture.expectedFee);
  }

  function test_PartialInteriorWithdrawalReconcilesAccounting() public {
    manager.setEntryFeeRate(ONE_PERCENT_WAD);
    manager.setWithdrawalFeeRate(FIVE_PERCENT_WAD);
    address buyer = makeAddr("partial-withdrawer");
    uint256 marketId = _createDefaultMarket();
    _fundAndApprove(buyer, 1_000 * WAD);
    (uint256 receiptId, MarketTypes.ReceiptQuote memory quote) = _placeReceiptAs(
      buyer,
      marketId,
      MarketTypes.Side.Yes,
      100 * WAD
    );
    uint256 entryFeePaid = manager.getReceipt(receiptId).entryFeePaid;

    int256 bandLow = 10 * int256(WAD);
    int256 bandHigh = 20 * int256(WAD);
    uint256 expectedGross = lmsr.segmentPathCost(
      bandLow,
      bandHigh,
      MarketTypes.Side.Yes,
      DEFAULT_B
    );
    uint256 expectedFee = (expectedGross * FIVE_PERCENT_WAD) / 1e18;
    uint256 expectedEntryFeeRefund = (entryFeePaid * expectedGross) / quote.cost;

    uint256 requestId = manager.requestReceiptWithdrawal(
      receiptId,
      buyer,
      _segment(bandLow, bandHigh)
    );
    MarketTypes.WithdrawalRequest memory stored = manager.getWithdrawalRequest(requestId);
    assertEq(stored.grossRefund, expectedGross);
    assertEq(stored.withdrawalFee, expectedFee);
    assertEq(stored.entryFeeRefund, expectedEntryFeeRefund);

    uint256 buyerBalanceBefore = collateral.balanceOf(buyer);
    manager.finalizeReceiptWithdrawal(requestId);

    assertEq(
      collateral.balanceOf(buyer),
      buyerBalanceBefore + expectedGross - expectedFee + expectedEntryFeeRefund
    );
    // A separate frame for the settled-state assertions dodges stack-too-deep.
    _assertPartialWithdrawalSettled(
      marketId,
      receiptId,
      quote.cost - expectedGross,
      entryFeePaid - expectedEntryFeeRefund,
      expectedFee
    );
  }

  function _assertPartialWithdrawalSettled(
    uint256 marketId,
    uint256 receiptId,
    uint256 remainingCost,
    uint256 remainingEntryFee,
    uint256 feeEarned
  ) private view {
    // The receipt keeps exactly the remainder: cost, fee, shares, and support.
    MarketTypes.Receipt memory receipt = manager.getReceipt(receiptId);
    assertEq(receipt.cost, remainingCost);
    assertEq(receipt.entryFeePaid, remainingEntryFee);
    assertEq(receipt.shares, 90 * WAD);

    MarketTypes.MarketState memory state = manager.getMarketState(marketId);
    assertEq(state.totalEscrowed, remainingCost);
    assertEq(state.path, 90 * int256(WAD));
    assertEq(state.yesShares, 90 * WAD);

    MarketTypes.PathSegment[] memory segments = manager.getReceiptSegments(receiptId);
    assertEq(segments.length, 2);
    assertEq(segments[0].rLow, 0);
    assertEq(segments[0].rHigh, 10 * int256(WAD));
    assertEq(segments[1].rLow, 20 * int256(WAD));
    assertEq(segments[1].rHigh, 100 * int256(WAD));

    assertEq(manager.marketEntryFeeEscrow(marketId), remainingEntryFee);
    assertEq(manager.marketWithdrawalFeesEarned(marketId), feeEarned);
  }

  function test_NoSideWithdrawalMovesPathBackUp() public {
    address buyer = makeAddr("no-withdrawer");
    uint256 marketId = _createDefaultMarket();
    _fundAndApprove(buyer, 1_000 * WAD);
    (uint256 receiptId, MarketTypes.ReceiptQuote memory quote) = _placeReceiptAs(
      buyer,
      marketId,
      MarketTypes.Side.No,
      100 * WAD
    );
    assertEq(manager.getMarketState(marketId).path, -100 * int256(WAD));

    MarketTypes.PathSegment[] memory claim = manager.getReceiptSegments(receiptId);
    uint256 requestId = manager.requestReceiptWithdrawal(receiptId, buyer, claim);
    uint256 buyerBalanceBefore = collateral.balanceOf(buyer);
    manager.finalizeReceiptWithdrawal(requestId);

    // Fee disarmed: the full recorded cost comes home and the NO placement's
    // path move reverses upward.
    assertEq(collateral.balanceOf(buyer), buyerBalanceBefore + quote.cost);
    MarketTypes.MarketState memory state = manager.getMarketState(marketId);
    assertEq(state.path, 0);
    assertEq(state.noShares, 0);
    assertEq(state.totalEscrowed, 0);
  }

  // ------------------------------------------------------- window and refutes

  function test_FinalizeWaitsForTheDeadlineAndPaysAtIt() public {
    manager.setWithdrawalChallengePeriod(1 hours);
    address buyer = makeAddr("window-buyer");
    uint256 marketId = _createDefaultMarket();
    _fundAndApprove(buyer, 1_000 * WAD);
    (uint256 receiptId, ) = _placeReceiptAs(buyer, marketId, MarketTypes.Side.Yes, 100 * WAD);

    uint256 requestId = manager.requestReceiptWithdrawal(
      receiptId,
      buyer,
      manager.getReceiptSegments(receiptId)
    );
    uint64 deadline = manager.getWithdrawalRequest(requestId).challengeDeadline;
    assertEq(deadline, uint64(block.timestamp) + 1 hours);

    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.WithdrawalChallengeActive.selector, requestId, deadline)
    );
    manager.finalizeReceiptWithdrawal(requestId);

    // At-or-after: the exact deadline second finalizes.
    vm.warp(deadline);
    manager.finalizeReceiptWithdrawal(requestId);
    assertEq(
      uint8(manager.getWithdrawalRequest(requestId).status),
      uint8(MarketTypes.WithdrawalRequestStatus.Finalized)
    );
  }

  function test_RefuteRequiresAnOpenWindow() public {
    manager.setWithdrawalChallengePeriod(1 hours);
    (uint256 requestId, , uint256 opposingReceiptId) = _requestOpposedTail();

    // Strictly inside the window only: at the deadline the refute is closed.
    uint64 deadline = manager.getWithdrawalRequest(requestId).challengeDeadline;
    vm.warp(deadline);
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.WithdrawalChallengeWindowClosed.selector,
        requestId,
        deadline
      )
    );
    manager.refuteWithdrawalRequest(requestId, opposingReceiptId);
  }

  function test_RefuteRestoresSupportAndCancelsRequest() public {
    manager.setWithdrawalChallengePeriod(1 hours);
    (uint256 requestId, uint256 receiptId, uint256 opposingReceiptId) = _requestOpposedTail();
    address challenger = makeAddr("challenger");

    vm.expectEmit(true, true, true, true, address(manager));
    emit PregradManager.ReceiptWithdrawalRefuted(
      requestId,
      receiptId,
      1,
      challenger,
      opposingReceiptId
    );
    vm.prank(challenger);
    manager.refuteWithdrawalRequest(requestId, opposingReceiptId);

    // The claimed band is back and merged into one segment.
    MarketTypes.PathSegment[] memory segments = manager.getReceiptSegments(receiptId);
    assertEq(segments.length, 1);
    assertEq(segments[0].rLow, 0);
    assertEq(segments[0].rHigh, 100 * int256(WAD));
    assertEq(manager.pendingWithdrawalRequestOf(receiptId), 0);
    assertEq(manager.marketPendingWithdrawals(1), 0);

    // Refuted is terminal: no second refute, no finalize.
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.WithdrawalRequestNotPending.selector,
        requestId,
        MarketTypes.WithdrawalRequestStatus.Refuted
      )
    );
    manager.refuteWithdrawalRequest(requestId, opposingReceiptId);
    vm.warp(block.timestamp + 2 hours);
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.WithdrawalRequestNotPending.selector,
        requestId,
        MarketTypes.WithdrawalRequestStatus.Refuted
      )
    );
    manager.finalizeReceiptWithdrawal(requestId);
  }

  function test_RefuteRejectsIneligibleOrNonOverlappingReceipts() public {
    manager.setWithdrawalChallengePeriod(1 hours);
    address buyer = makeAddr("pin-buyer");
    address opponent = makeAddr("pin-opponent");
    uint256 marketId = _createDefaultMarket();
    _fundAndApprove(buyer, 1_000 * WAD);
    _fundAndApprove(opponent, 1_000 * WAD);
    (uint256 receiptId, ) = _placeReceiptAs(buyer, marketId, MarketTypes.Side.Yes, 100 * WAD);
    // A same-side receipt can never refute.
    (uint256 sameSideId, ) = _placeReceiptAs(opponent, marketId, MarketTypes.Side.Yes, 10 * WAD);

    uint256 requestId = manager.requestReceiptWithdrawal(
      receiptId,
      buyer,
      _segment(0, 100 * int256(WAD))
    );

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.WithdrawalClaimNotRefuted.selector,
        requestId,
        sameSideId
      )
    );
    manager.refuteWithdrawalRequest(requestId, sameSideId);

    // Snapshot pinning: opposite-side coverage placed after the request holds
    // ids at or above the stamped snapshot and cannot refute.
    (uint256 lateOpposerId, ) = _placeReceiptAs(opponent, marketId, MarketTypes.Side.No, 50 * WAD);
    assertGe(lateOpposerId, manager.getWithdrawalRequest(requestId).nextReceiptIdSnapshot);
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.WithdrawalClaimNotRefuted.selector,
        requestId,
        lateOpposerId
      )
    );
    manager.refuteWithdrawalRequest(requestId, lateOpposerId);

    // The honest claim finalizes despite the late opposition.
    vm.warp(block.timestamp + 1 hours);
    manager.finalizeReceiptWithdrawal(requestId);
  }

  function test_RefuteRejectsNonOverlappingOppositeCoverage() public {
    manager.setWithdrawalChallengePeriod(1 hours);
    address buyer = makeAddr("disjoint-buyer");
    address opponent = makeAddr("disjoint-opponent");
    uint256 marketId = _createDefaultMarket();
    _fundAndApprove(buyer, 1_000 * WAD);
    _fundAndApprove(opponent, 1_000 * WAD);
    (uint256 yesReceiptId, ) = _placeReceiptAs(buyer, marketId, MarketTypes.Side.Yes, 100 * WAD);
    // NO coverage over [70, 100): opposes only the tail.
    (uint256 noReceiptId, ) = _placeReceiptAs(opponent, marketId, MarketTypes.Side.No, 30 * WAD);

    // Claim the genuinely free head; the opposite receipt does not overlap it.
    uint256 requestId = manager.requestReceiptWithdrawal(
      yesReceiptId,
      buyer,
      _segment(0, 50 * int256(WAD))
    );
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.WithdrawalClaimNotRefuted.selector,
        requestId,
        noReceiptId
      )
    );
    manager.refuteWithdrawalRequest(requestId, noReceiptId);
  }

  // ------------------------------------------------------- the collusion chain

  function test_CollusionChainDiesInOrder() public {
    manager.setWithdrawalChallengePeriod(1 hours);
    address colluderA = makeAddr("colluder-a");
    address colluderB = makeAddr("colluder-b");
    address watcher = makeAddr("honest-watcher");
    uint256 marketId = _createDefaultMarket();
    _fundAndApprove(colluderA, 1_000 * WAD);
    _fundAndApprove(colluderB, 1_000 * WAD);

    // A holds YES over [0, 100]; B holds NO over [70, 100]. The band [70, 100)
    // is opposed for both.
    (uint256 receiptA, MarketTypes.ReceiptQuote memory quoteA) = _placeReceiptAs(
      colluderA,
      marketId,
      MarketTypes.Side.Yes,
      100 * WAD
    );
    (uint256 receiptB, MarketTypes.ReceiptQuote memory quoteB) = _placeReceiptAs(
      colluderB,
      marketId,
      MarketTypes.Side.No,
      30 * WAD
    );
    uint256 escrowBefore = manager.getMarketState(marketId).totalEscrowed;
    assertEq(escrowBefore, quoteA.cost + quoteB.cost);

    // Both sides of the opposed band file false free-claims. B's passes the
    // structural checks because opposition is never checked at request time.
    uint256 requestA = manager.requestReceiptWithdrawal(
      receiptA,
      colluderA,
      _segment(70 * int256(WAD), 100 * int256(WAD))
    );
    uint256 requestB = manager.requestReceiptWithdrawal(
      receiptB,
      colluderB,
      _segment(70 * int256(WAD), 100 * int256(WAD))
    );

    // Same-block requests share a deadline — equality is allowed — so B can
    // never finalize while A is still challengeable.
    uint64 deadlineA = manager.getWithdrawalRequest(requestA).challengeDeadline;
    uint64 deadlineB = manager.getWithdrawalRequest(requestB).challengeDeadline;
    assertEq(deadlineA, deadlineB);
    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.WithdrawalChallengeActive.selector, requestB, deadlineB)
    );
    manager.finalizeReceiptWithdrawal(requestB);

    // One watcher kills both, in order: A's claim dies by B's
    // pending-recorded coverage — B's segments left live support but stay
    // recorded on its pending request — and B's claim dies by A's restored
    // coverage.
    vm.startPrank(watcher);
    manager.refuteWithdrawalRequest(requestA, receiptB);
    manager.refuteWithdrawalRequest(requestB, receiptA);
    vm.stopPrank();

    // Both books are whole, escrow never moved, and nothing paid out.
    // A separate frame for the assertions dodges stack-too-deep.
    _assertCollusionUnwound(marketId, receiptA, receiptB, escrowBefore);
    assertEq(collateral.balanceOf(colluderA), 1_000 * WAD - quoteA.cost);
    assertEq(collateral.balanceOf(colluderB), 1_000 * WAD - quoteB.cost);
  }

  function _assertCollusionUnwound(
    uint256 marketId,
    uint256 receiptA,
    uint256 receiptB,
    uint256 escrowBefore
  ) private view {
    assertEq(manager.getMarketState(marketId).totalEscrowed, escrowBefore);
    assertEq(manager.marketPendingWithdrawals(marketId), 0);
    MarketTypes.PathSegment[] memory segmentsA = manager.getReceiptSegments(receiptA);
    assertEq(segmentsA.length, 1);
    assertEq(segmentsA[0].rLow, 0);
    assertEq(segmentsA[0].rHigh, 100 * int256(WAD));
    MarketTypes.PathSegment[] memory segmentsB = manager.getReceiptSegments(receiptB);
    assertEq(segmentsB.length, 1);
    assertEq(segmentsB[0].rLow, 70 * int256(WAD));
    assertEq(segmentsB[0].rHigh, 100 * int256(WAD));
  }

  function test_DeadlinesClampMonotonePerMarket() public {
    manager.setWithdrawalChallengePeriod(2 hours);
    address buyer = makeAddr("monotone-buyer");
    uint256 marketId = _createDefaultMarket();
    uint256 otherMarketId = _createDefaultMarket();
    _fundAndApprove(buyer, 2_000 * WAD);
    (uint256 firstReceipt, ) = _placeReceiptAs(buyer, marketId, MarketTypes.Side.Yes, 50 * WAD);
    (uint256 secondReceipt, ) = _placeReceiptAs(buyer, marketId, MarketTypes.Side.Yes, 50 * WAD);
    (uint256 otherReceipt, ) = _placeReceiptAs(
      buyer,
      otherMarketId,
      MarketTypes.Side.Yes,
      50 * WAD
    );

    uint256 firstRequest = manager.requestReceiptWithdrawal(
      firstReceipt,
      buyer,
      manager.getReceiptSegments(firstReceipt)
    );
    uint64 firstDeadline = manager.getWithdrawalRequest(firstRequest).challengeDeadline;
    assertEq(firstDeadline, uint64(block.timestamp) + 2 hours);

    // The owner shortens the window; a later request's raw deadline would
    // precede the first request's, so it clamps to it (ADR 0014 P3).
    manager.setWithdrawalChallengePeriod(0);
    uint256 secondRequest = manager.requestReceiptWithdrawal(
      secondReceipt,
      buyer,
      manager.getReceiptSegments(secondReceipt)
    );
    assertEq(manager.getWithdrawalRequest(secondRequest).challengeDeadline, firstDeadline);
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.WithdrawalChallengeActive.selector,
        secondRequest,
        firstDeadline
      )
    );
    manager.finalizeReceiptWithdrawal(secondRequest);

    // The clamp is per market: another market's request keeps the zero window.
    uint256 otherRequest = manager.requestReceiptWithdrawal(
      otherReceipt,
      buyer,
      manager.getReceiptSegments(otherReceipt)
    );
    assertEq(manager.getWithdrawalRequest(otherRequest).challengeDeadline, uint64(block.timestamp));
    manager.finalizeReceiptWithdrawal(otherRequest);
  }

  // ------------------------------------------------------------ cap and freeze

  function test_SegmentCapBlocksAnOverFragmentingRequest() public {
    address buyer = makeAddr("cap-buyer");
    uint256 marketId = _createDefaultMarket();
    _fundAndApprove(buyer, 1_000 * WAD);
    (uint256 receiptId, ) = _placeReceiptAs(buyer, marketId, MarketTypes.Side.Yes, 100 * WAD);

    // Seven interior slivers (request+finalize at the zero window) leave
    // eight live segments — the cap.
    for (uint256 i = 1; i <= 7; ++i) {
      int256 bandLow = int256(i) * 10 * int256(WAD);
      uint256 requestId = manager.requestReceiptWithdrawal(
        receiptId,
        buyer,
        _segment(bandLow, bandLow + int256(WAD))
      );
      manager.finalizeReceiptWithdrawal(requestId);
    }
    assertEq(manager.getReceiptSegments(receiptId).length, manager.MAX_RECEIPT_SEGMENTS());

    // An eighth interior split would exceed the cap and the request reverts;
    // the band still refunds in full at clearing, so the cap only delays exit.
    vm.expectRevert(
      abi.encodeWithSelector(
        ReceiptBands.SegmentCapExceeded.selector,
        85 * int256(WAD),
        86 * int256(WAD),
        8
      )
    );
    manager.requestReceiptWithdrawal(
      receiptId,
      buyer,
      _segment(85 * int256(WAD), 86 * int256(WAD))
    );
  }

  function test_StartGraduationWaitsForPendingWithdrawals() public {
    address buyer = makeAddr("freeze-buyer");
    uint256 marketId = _createGraduatableMarket();
    _fundAndApprove(buyer, 1_000 * WAD);
    (uint256 receiptId, ) = _placeReceiptAs(buyer, marketId, MarketTypes.Side.Yes, 100 * WAD);

    uint256 requestId = manager.requestReceiptWithdrawal(
      receiptId,
      buyer,
      _segment(0, 10 * int256(WAD))
    );
    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.PendingWithdrawalsBlockGraduation.selector, marketId, 1)
    );
    manager.startGraduation(marketId);

    // At the zero window the manager settles and freezes in the next
    // transaction — the ADR's "trivial at a zero window".
    manager.finalizeReceiptWithdrawal(requestId);
    manager.startGraduation(marketId);
    assertEq(
      uint8(manager.getMarketState(marketId).status),
      uint8(MarketTypes.MarketStatus.Graduating)
    );
  }

  function test_PendingRequestIsVoidOnceTheMarketLeavesActive() public {
    manager.setEntryFeeRate(ONE_PERCENT_WAD);
    manager.setWithdrawalFeeRate(FIVE_PERCENT_WAD);
    manager.setWithdrawalChallengePeriod(1 hours);
    address buyer = makeAddr("void-buyer");
    uint256 marketId = _createDefaultMarket();
    _fundAndApprove(buyer, 1_000 * WAD);
    (uint256 receiptId, MarketTypes.ReceiptQuote memory quote) = _placeReceiptAs(
      buyer,
      marketId,
      MarketTypes.Side.No,
      100 * WAD
    );
    uint256 entryFeePaid = manager.getReceipt(receiptId).entryFeePaid;

    uint256 requestId = manager.requestReceiptWithdrawal(
      receiptId,
      buyer,
      manager.getReceiptSegments(receiptId)
    );

    // The market misses graduation while the request is pending.
    vm.warp(manager.getMarketConfig(marketId).graduationDeadline);
    manager.markRefundable(marketId);

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidMarketStatus.selector,
        marketId,
        MarketTypes.MarketStatus.Refunded,
        MarketTypes.MarketStatus.Active
      )
    );
    manager.finalizeReceiptWithdrawal(requestId);

    // The full receipt refunds instead — cost and entry fee whole, no
    // withdrawal fee: the never-finalized withdrawal earned nothing
    // (ADR 0014 §3's success-fee rule).
    uint256 buyerBalanceBefore = collateral.balanceOf(buyer);
    manager.claimRefundedReceipt(receiptId);
    assertEq(collateral.balanceOf(buyer), buyerBalanceBefore + quote.cost + entryFeePaid);
    assertEq(manager.marketWithdrawalFeesEarned(marketId), 0);
    assertEq(collateral.balanceOf(address(manager)), 0);
  }

  // ------------------------------------------------------------------- sweeps

  function test_WithdrawEarnedWithdrawalFees() public {
    manager.setWithdrawalFeeRate(FIVE_PERCENT_WAD);
    address buyer = makeAddr("sweep-buyer");
    uint256 marketId = _createDefaultMarket();
    _fundAndApprove(buyer, 1_000 * WAD);
    (uint256 receiptId, ) = _placeReceiptAs(buyer, marketId, MarketTypes.Side.Yes, 100 * WAD);
    uint256 requestId = manager.requestReceiptWithdrawal(
      receiptId,
      buyer,
      manager.getReceiptSegments(receiptId)
    );
    manager.finalizeReceiptWithdrawal(requestId);
    uint256 earned = manager.marketWithdrawalFeesEarned(marketId);
    assertGt(earned, 0);

    address recipient = makeAddr("withdrawal-fee-treasury");

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.WithdrawalFeeWithdrawalExceedsEarned.selector,
        earned,
        earned + 1
      )
    );
    manager.withdrawEarnedWithdrawalFees(marketId, recipient, earned + 1);

    vm.expectRevert(abi.encodeWithSelector(PregradManager.InvalidWithdrawalFeeRecipient.selector));
    manager.withdrawEarnedWithdrawalFees(marketId, address(0), 0);

    address notOwner = makeAddr("sweep-stranger");
    vm.prank(notOwner);
    vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, notOwner));
    manager.withdrawEarnedWithdrawalFees(marketId, recipient, 0);

    // Zero amount sweeps the full earned balance.
    vm.expectEmit(true, true, true, true, address(manager));
    emit PregradManager.EarnedWithdrawalFeesWithdrawn(marketId, recipient, earned);
    manager.withdrawEarnedWithdrawalFees(marketId, recipient, 0);

    assertEq(collateral.balanceOf(recipient), earned);
    assertEq(manager.marketWithdrawalFeesEarned(marketId), 0);
    assertEq(collateral.balanceOf(address(manager)), 0);
  }

  function test_GetWithdrawalRequestRevertsForUnknownId() public {
    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.WithdrawalRequestDoesNotExist.selector, 1)
    );
    manager.getWithdrawalRequest(1);
    assertEq(manager.nextWithdrawalRequestId(), 1);
  }

  // ----------------------------------------------------------------- fixtures

  /// Places an opposed YES/NO pair and files a false free-claim over the
  /// opposed tail [80, 90) of the YES receipt.
  function _requestOpposedTail()
    private
    returns (uint256 requestId, uint256 receiptId, uint256 opposingReceiptId)
  {
    address buyer = makeAddr("opposed-buyer");
    address opponent = makeAddr("opposed-opponent");
    uint256 marketId = _createDefaultMarket();
    _fundAndApprove(buyer, 1_000 * WAD);
    _fundAndApprove(opponent, 1_000 * WAD);
    (receiptId, ) = _placeReceiptAs(buyer, marketId, MarketTypes.Side.Yes, 100 * WAD);
    (opposingReceiptId, ) = _placeReceiptAs(opponent, marketId, MarketTypes.Side.No, 30 * WAD);

    requestId = manager.requestReceiptWithdrawal(
      receiptId,
      buyer,
      _segment(80 * int256(WAD), 90 * int256(WAD))
    );
  }

  function _segment(
    int256 rLow,
    int256 rHigh
  ) private pure returns (MarketTypes.PathSegment[] memory segments) {
    segments = new MarketTypes.PathSegment[](1);
    segments[0] = MarketTypes.PathSegment({rLow: rLow, rHigh: rHigh});
  }

  function _createDefaultMarket() private returns (uint256) {
    return
      manager.createMarket(_defaultMarketParams(_defaultMetadataHash()), _zeroedAuthorization());
  }

  function _createGraduatableMarket() private returns (uint256 marketId) {
    MarketTypes.CreateMarketParams memory params = _defaultMarketParams(_defaultMetadataHash());
    params.graduationThreshold = 50 * WAD;
    marketId = manager.createMarket(params, _zeroedAuthorization());
  }

  function _defaultMarketParams(
    bytes32 metadataHash
  ) private view returns (MarketTypes.CreateMarketParams memory) {
    return
      MarketTypes.CreateMarketParams({
        collateral: address(collateral),
        metadataHash: metadataHash,
        metadata: _defaultMetadata(),
        openingProbabilityWad: (50 * WAD) / 100,
        liquidityParameter: DEFAULT_B,
        graduationThreshold: 2_500 * WAD,
        graduationDeadline: uint64(block.timestamp + 7 days),
        resolutionTime: uint64(block.timestamp + 14 days),
        yesNotBefore: uint64(block.timestamp + 14 days),
        bypassAiResolution: false
      });
  }

  function _defaultMetadata() private pure returns (string memory) {
    // solhint-disable quotes
    return
      string.concat(
        '{"version":1,"question":"Will this withdrawal market resolve?",',
        '"description":"","category":"Test",',
        '"resolutionCriteria":"Resolves according to test fixtures.",',
        '"createdAt":"2026-01-01T00:00:00.000Z"}'
      );
    // solhint-enable quotes
  }

  function _defaultMetadataHash() private pure returns (bytes32) {
    return keccak256(bytes(_defaultMetadata()));
  }

  function _placeReceiptAs(
    address buyer,
    uint256 marketId,
    MarketTypes.Side side,
    uint256 shares
  ) private returns (uint256 receiptId, MarketTypes.ReceiptQuote memory quote) {
    quote = manager.quoteReceipt(marketId, side, shares);
    // Computed before the prank: an external call in the argument expression
    // would consume it and place the receipt as the test contract instead.
    uint256 maxTotalDebit = quote.cost + manager.entryFeeFor(quote.cost);

    vm.prank(buyer);
    receiptId = manager.placeReceipt(
      MarketTypes.PlaceReceiptParams({
        marketId: marketId,
        side: side,
        shares: shares,
        maxCost: maxTotalDebit
      })
    );
  }

  function _fundAndApprove(address account, uint256 amount) private {
    _fundAndApprove(account, address(manager), amount, type(uint256).max);
  }
}
