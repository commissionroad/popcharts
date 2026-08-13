// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {LmsrMath} from "./LmsrMath.sol";
import {ReceiptBands} from "./ReceiptBands.sol";
import {MarketTypes} from "../types/MarketTypes.sol";

/// @notice Reverts when a band restore targets a receipt no band was removed from.
error SupportNotSegmented();

/// @title ReceiptWithdrawals
/// @author Pop Charts
/// @notice The optimistic receipt-withdrawal state machine of ADR 0014 P3:
///   request removes claimed segments from live support and stamps the
///   record, a successful refutation restores them, finalization settles
///   receipt, market, and fee accounting.
/// @dev Deployed as an external library and delegatecalled by
///      `PregradManager`, which was within 2% of the EIP-170 code-size limit
///      before this mechanism existed. The split follows one rule so the
///      manager's generated ABI stays the complete indexer surface: every
///      event and every withdrawal-specific error lives in the manager, which
///      guards and emits; this library only mutates. The reverts it can raise
///      are `ReceiptBands`' structural band errors and this file's
///      `SupportNotSegmented` — a cannot-happen defensive, since a restore
///      only follows a removal.
library ReceiptWithdrawals {
  /// @notice All withdrawal-mechanism storage, held by the manager.
  struct Store {
    /// @notice Challenge window applied to new requests; zero finalizes immediately.
    uint64 challengePeriod;
    /// @notice Withdrawal fee rate charged on a request's gross refund, scaled by 1e18.
    uint256 feeRateWad;
    /// @notice Number of requests ever created; request IDs start at 1.
    uint256 requestCount;
    /// @notice Stored requests by ID.
    mapping(uint256 requestId => MarketTypes.WithdrawalRequest) requests;
    /// @notice The pending request of a receipt, or zero when none.
    mapping(uint256 receiptId => uint256 requestId) pendingRequestOf;
    /// @notice Number of requests still pending per market.
    mapping(uint256 marketId => uint256 pendingRequests) marketPendingRequests;
    /// @notice Latest challenge deadline ever stamped per market; never reset.
    mapping(uint256 marketId => uint64 lastDeadline) marketLastDeadline;
    /// @notice Withdrawal fees earned by finalized withdrawals per market.
    mapping(uint256 marketId => uint256 feesEarned) marketFeesEarned;
  }

  /// @notice Removes the band `[lower, upper]` from a receipt's live support,
  ///   materializing the P1 overlay on first removal.
  /// @dev Reverts with `ReceiptBands.EmptyBand`,
  ///      `ReceiptBands.BandOutsideLiveSupport`, or
  ///      `ReceiptBands.SegmentCapExceeded`. A removal that empties the list
  ///      leaves the receipt with genuinely empty live support.
  /// @param support Receipt support overlay losing the band.
  /// @param receipt Receipt record carrying the placement interval.
  /// @param lower Lower path endpoint of the removed band.
  /// @param upper Upper path endpoint of the removed band.
  /// @param segmentCap Maximum stored segments after the removal.
  function removeSupportBand(
    MarketTypes.ReceiptSupport storage support,
    MarketTypes.Receipt storage receipt,
    int256 lower,
    int256 upper,
    uint256 segmentCap
  ) public {
    if (!support.segmented) {
      support.segmented = true;
      support.segments.push(MarketTypes.PathSegment({rLow: receipt.rLow, rHigh: receipt.rHigh}));
    }

    ReceiptBands.removeBand(support.segments, lower, upper, segmentCap);
  }

  /// @notice Restores the band `[lower, upper]` to a receipt's live support,
  ///   merging with touching neighbors — the inverse of `removeSupportBand`.
  /// @dev Only bands a prior removal took may be restored, so the support is
  ///      always segmented here; a restore that overlaps live support reverts
  ///      with `ReceiptBands.BandOverlapsLiveSupport`.
  /// @param support Receipt support overlay regaining the band.
  /// @param lower Lower path endpoint of the restored band.
  /// @param upper Upper path endpoint of the restored band.
  function restoreSupportBand(
    MarketTypes.ReceiptSupport storage support,
    int256 lower,
    int256 upper
  ) public {
    if (!support.segmented) {
      revert SupportNotSegmented();
    }

    ReceiptBands.restoreBand(support.segments, lower, upper);
  }

  /// @notice Returns the withdrawal fee due on a gross refund at the stored rate.
  /// @dev The one place the convention lives: a full-precision mulDiv floored
  ///      once on the request's whole gross — never per segment — so the
  ///      payout cannot depend on fragmentation and the on-chain fee always
  ///      equals the P2 quote's (`withdrawal-quote.ts`; ADR 0014 P4b). The
  ///      manager's `withdrawalFeeFor` view and the request stamp both call
  ///      this.
  /// @param store Withdrawal storage carrying the current rate.
  /// @param grossRefund Recorded cost the fee is charged on.
  /// @return Fee amount, rounded down.
  function feeFor(Store storage store, uint256 grossRefund) public view returns (uint256) {
    return Math.mulDiv(grossRefund, store.feeRateWad, 1e18);
  }

  /// @notice Creates a pending withdrawal request: removes each claimed
  ///   segment from live support, prices the claim, and stamps the record.
  /// @dev Every trust-critical field is stamped here from contract state —
  ///      the window from the stored period, the deadline clamped to the
  ///      market's latest so it never precedes an earlier request's, and the
  ///      snapshot from the caller's receipt-ID counter. Amounts are stored,
  ///      never re-derived at finalization: the fee once on the gross at the
  ///      current rate, and the entry-fee share pro-rated over the withdrawn
  ///      cost with the same mulDiv convention (ADR 0014 §3, P3). Each
  ///      segment is priced by the same closed-form band cost placement
  ///      locked; segment costs telescope inside the placement interval, so
  ///      the gross never exceeds the receipt's recorded cost — the cap
  ///      guards the wei-level rounding corner, keeping escrow over- rather
  ///      than under-collateralized. Nothing moves money here.
  /// @param store Withdrawal storage being written.
  /// @param support Receipt support overlay losing the claimed segments.
  /// @param receipt Receipt record being withdrawn from.
  /// @param receiptId Receipt ID being withdrawn from.
  /// @param liquidityParameter Market's virtual LMSR smoothness parameter.
  /// @param nextReceiptIdSnapshot Refutation-set bound read by the caller.
  /// @param segmentCap Maximum stored live-support segments per receipt.
  /// @param segments Claimed segments, ascending and disjoint.
  /// @return requestId Canonical withdrawal request ID.
  function request(
    Store storage store,
    MarketTypes.ReceiptSupport storage support,
    MarketTypes.Receipt storage receipt,
    uint256 receiptId,
    uint256 liquidityParameter,
    uint256 nextReceiptIdSnapshot,
    uint256 segmentCap,
    MarketTypes.PathSegment[] calldata segments
  ) external returns (uint256 requestId) {
    uint256 grossRefund = 0;
    for (uint256 i = 0; i < segments.length; ++i) {
      MarketTypes.PathSegment calldata segment = segments[i];
      removeSupportBand(support, receipt, segment.rLow, segment.rHigh, segmentCap);
      grossRefund += LmsrMath.segmentPathCost(
        segment.rLow,
        segment.rHigh,
        receipt.side,
        liquidityParameter
      );
    }
    if (grossRefund > receipt.cost) {
      grossRefund = receipt.cost;
    }

    uint64 challengeDeadline = uint64(block.timestamp) + store.challengePeriod;
    uint64 lastDeadline = store.marketLastDeadline[receipt.marketId];
    if (challengeDeadline < lastDeadline) {
      challengeDeadline = lastDeadline;
    }
    store.marketLastDeadline[receipt.marketId] = challengeDeadline;

    uint256 entryFeePaid = receipt.entryFeePaid;
    requestId = ++store.requestCount;

    MarketTypes.WithdrawalRequest storage stored = store.requests[requestId];
    stored.receiptId = receiptId;
    stored.marketId = receipt.marketId;
    stored.owner = receipt.owner;
    stored.challengeDeadline = challengeDeadline;
    stored.status = MarketTypes.WithdrawalRequestStatus.Pending;
    stored.grossRefund = grossRefund;
    stored.withdrawalFee = feeFor(store, grossRefund);
    stored.entryFeeRefund =
      entryFeePaid == 0 ? 0 : Math.mulDiv(entryFeePaid, grossRefund, receipt.cost);
    stored.nextReceiptIdSnapshot = nextReceiptIdSnapshot;
    for (uint256 i = 0; i < segments.length; ++i) {
      stored.segments.push(segments[i]);
    }

    store.pendingRequestOf[receiptId] = requestId;
    ++store.marketPendingRequests[receipt.marketId];
  }

  /// @notice Attempts to refute a pending request with one named opposite-side
  ///   receipt; on success cancels the request and restores its segments.
  /// @dev The recorded coverage that refutes is the named receipt's live
  ///      support plus its own still-pending claimed segments, which stay
  ///      recorded until finalization exactly so a colluding opposer's
  ///      withdrawal cannot outrun refutation (ADR 0014 P3's first race
  ///      rule). The snapshot bound pins the refutation set to receipts that
  ///      existed at request time. A failed refutation mutates nothing and
  ///      returns false — the manager turns that into its revert.
  /// @param store Withdrawal storage being read and written.
  /// @param requestId Pending request under refutation.
  /// @param refutingReceiptId Receipt named as the counterexample.
  /// @param refuter Named receipt's stored record.
  /// @param claimantSide Side of the receipt the request withdraws from.
  /// @param claimantSupport Claimant receipt's support overlay, for restore.
  /// @param refuterLiveCoverage Named receipt's live support, read by the caller.
  /// @return refuted True when the claim was refuted and the request cancelled.
  function refute(
    Store storage store,
    uint256 requestId,
    uint256 refutingReceiptId,
    MarketTypes.Receipt storage refuter,
    MarketTypes.Side claimantSide,
    MarketTypes.ReceiptSupport storage claimantSupport,
    MarketTypes.PathSegment[] memory refuterLiveCoverage
  ) external returns (bool refuted) {
    MarketTypes.WithdrawalRequest storage stored = store.requests[requestId];
    if (
      refuter.marketId != stored.marketId ||
      refuter.side == claimantSide ||
      !refuter.active ||
      refutingReceiptId >= stored.nextReceiptIdSnapshot
    ) {
      return false;
    }

    if (!_claimOverlapsCoverage(stored.segments, refuterLiveCoverage)) {
      uint256 refuterPendingId = store.pendingRequestOf[refutingReceiptId];
      if (
        refuterPendingId == 0 ||
        !_claimOverlapsCoverage(stored.segments, store.requests[refuterPendingId].segments)
      ) {
        return false;
      }
    }

    _cancelPendingRequest(
      store,
      stored,
      claimantSupport,
      MarketTypes.WithdrawalRequestStatus.Refuted
    );
    return true;
  }

  /// @notice Voids a pending request whose market left Active before
  ///   finalization: flips it Voided, clears the pending trackers, and
  ///   restores the claimed segments to live support.
  /// @dev The refund path pays the receipt's full remaining cost and held
  ///      entry fee without reading live support, so the restore is cosmetic
  ///      for the money — it keeps `getReceiptSegments` truthful — and no
  ///      withdrawal fee is charged: the never-finalized act earned nothing
  ///      (ADR 0014 §3). The manager guards status and market and emits.
  /// @param store Withdrawal storage being written.
  /// @param requestId Pending request being voided.
  /// @param claimantSupport Claimant receipt's support overlay, for restore.
  function voidRequest(
    Store storage store,
    uint256 requestId,
    MarketTypes.ReceiptSupport storage claimantSupport
  ) external {
    _cancelPendingRequest(
      store,
      store.requests[requestId],
      claimantSupport,
      MarketTypes.WithdrawalRequestStatus.Voided
    );
  }

  /// @notice Cancels a pending request into a terminal status and restores
  ///   its claimed segments — the shared tail of refutation and voiding.
  /// @param store Withdrawal storage being written.
  /// @param stored Pending request being cancelled.
  /// @param claimantSupport Claimant receipt's support overlay, for restore.
  /// @param terminalStatus Refuted or Voided.
  function _cancelPendingRequest(
    Store storage store,
    MarketTypes.WithdrawalRequest storage stored,
    MarketTypes.ReceiptSupport storage claimantSupport,
    MarketTypes.WithdrawalRequestStatus terminalStatus
  ) private {
    stored.status = terminalStatus;
    store.pendingRequestOf[stored.receiptId] = 0;
    --store.marketPendingRequests[stored.marketId];

    uint256 segmentCount = stored.segments.length;
    for (uint256 i = 0; i < segmentCount; ++i) {
      MarketTypes.PathSegment storage segment = stored.segments[i];
      restoreSupportBand(claimantSupport, segment.rLow, segment.rHigh);
    }
  }

  /// @notice Settles a matured request: flips it Finalized and reverses
  ///   placement's writes pro rata to the withdrawn segments.
  /// @dev Escrow and the receipt's recorded cost drop by the gross (segment
  ///      costs telescope, so the remainder is exactly the live support's
  ///      recorded cost); the receipt's shares and its side's tally drop by
  ///      the withdrawn width (share quantity is path width at placement);
  ///      and the path moves back by that width — down for YES, up for NO —
  ///      the side-aware reading of ADR 0014 P3's "decrement `state.path`",
  ///      preserving `path = openingPath + yesShares - noShares`. The refund
  ///      and claim paths decrement `totalEscrowed` alone only because they
  ///      run on terminal markets whose path no longer prices; a withdrawal
  ///      runs on an Active market, so the whole placement write-set
  ///      reverses. The held entry fee escrow releases the pro-rated share
  ///      and the withdrawal fee lands in the market's earned pot. The
  ///      manager pays the owner and emits.
  /// @param store Withdrawal storage being written.
  /// @param requestId Matured request being finalized.
  /// @param receipt Receipt record being settled.
  /// @param marketState Market accounting state being decremented.
  /// @param marketEntryFeeEscrow Held entry-fee escrow map being decremented.
  /// @return escrowRefund Escrowed cost owed to the owner, net of the fee.
  function finalize(
    Store storage store,
    uint256 requestId,
    MarketTypes.Receipt storage receipt,
    MarketTypes.MarketState storage marketState,
    mapping(uint256 marketId => uint256) storage marketEntryFeeEscrow
  ) external returns (uint256 escrowRefund) {
    MarketTypes.WithdrawalRequest storage stored = store.requests[requestId];
    stored.status = MarketTypes.WithdrawalRequestStatus.Finalized;
    store.pendingRequestOf[stored.receiptId] = 0;
    --store.marketPendingRequests[stored.marketId];

    uint256 widthWithdrawn = 0;
    uint256 segmentCount = stored.segments.length;
    for (uint256 i = 0; i < segmentCount; ++i) {
      MarketTypes.PathSegment storage segment = stored.segments[i];
      widthWithdrawn += uint256(segment.rHigh - segment.rLow);
    }

    receipt.cost -= stored.grossRefund;
    receipt.entryFeePaid -= stored.entryFeeRefund;
    receipt.shares -= widthWithdrawn;
    marketState.totalEscrowed -= stored.grossRefund;
    if (receipt.side == MarketTypes.Side.Yes) {
      marketState.path -= int256(widthWithdrawn);
      marketState.yesShares -= widthWithdrawn;
    } else {
      marketState.path += int256(widthWithdrawn);
      marketState.noShares -= widthWithdrawn;
    }

    if (stored.entryFeeRefund != 0) {
      marketEntryFeeEscrow[stored.marketId] -= stored.entryFeeRefund;
    }
    if (stored.withdrawalFee != 0) {
      store.marketFeesEarned[stored.marketId] += stored.withdrawalFee;
    }

    escrowRefund = stored.grossRefund - stored.withdrawalFee;
  }

  /// @notice Returns whether any claimed segment overlaps any coverage segment.
  /// @param claimed Claimed segments of the request under refutation.
  /// @param coverage Coverage segments of the named refuting receipt.
  /// @return True when a positive-width overlap exists.
  function _claimOverlapsCoverage(
    MarketTypes.PathSegment[] storage claimed,
    MarketTypes.PathSegment[] memory coverage
  ) private view returns (bool) {
    uint256 claimedCount = claimed.length;
    for (uint256 i = 0; i < claimedCount; ++i) {
      MarketTypes.PathSegment storage segment = claimed[i];
      for (uint256 j = 0; j < coverage.length; ++j) {
        if (
          ReceiptBands.overlaps(segment.rLow, segment.rHigh, coverage[j].rLow, coverage[j].rHigh)
        ) {
          return true;
        }
      }
    }
    return false;
  }
}
