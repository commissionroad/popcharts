// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarketTypes} from "../types/MarketTypes.sol";

/// @title ReceiptBands
/// @author Pop Charts
/// @notice Helpers for receipt path-band arithmetic.
library ReceiptBands {
  /// @notice Reverts when a path band has no positive width.
  /// @param lower Lower path endpoint.
  /// @param upper Upper path endpoint.
  error EmptyBand(int256 lower, int256 upper);
  /// @notice Reverts when a removed band is not contained in one live segment.
  /// @param lower Lower path endpoint of the rejected band.
  /// @param upper Upper path endpoint of the rejected band.
  error BandOutsideLiveSupport(int256 lower, int256 upper);
  /// @notice Reverts when a restored band overlaps a live segment.
  /// @param lower Lower path endpoint of the rejected band.
  /// @param upper Upper path endpoint of the rejected band.
  error BandOverlapsLiveSupport(int256 lower, int256 upper);
  /// @notice Reverts when splitting a segment would exceed the segment cap.
  /// @param lower Lower path endpoint of the rejected band.
  /// @param upper Upper path endpoint of the rejected band.
  /// @param segmentCap Maximum number of stored segments.
  error SegmentCapExceeded(int256 lower, int256 upper, uint256 segmentCap);

  /// @notice Returns the positive width of a path band.
  /// @param lower Lower path endpoint.
  /// @param upper Upper path endpoint.
  /// @return Positive band width.
  function width(int256 lower, int256 upper) internal pure returns (uint256) {
    if (upper <= lower) {
      revert EmptyBand(lower, upper);
    }

    return uint256(upper - lower);
  }

  /// @notice Returns whether two half-open path intervals overlap.
  /// @param leftLower Lower endpoint of the left interval.
  /// @param leftUpper Upper endpoint of the left interval.
  /// @param rightLower Lower endpoint of the right interval.
  /// @param rightUpper Upper endpoint of the right interval.
  /// @return True if the intervals overlap.
  function overlaps(
    int256 leftLower,
    int256 leftUpper,
    int256 rightLower,
    int256 rightUpper
  ) internal pure returns (bool) {
    return leftLower < rightUpper && rightLower < leftUpper;
  }

  /// @notice Removes the band `[lower, upper]` from a live-support segment
  ///   list, splitting the containing segment when the band is interior.
  /// @dev The list must be — and stays — ascending, disjoint, non-touching,
  ///      and positive-width. The band must lie inside exactly one segment:
  ///      a band that spans a withdrawn gap or reaches outside the support
  ///      reverts, so callers remove one contained band per call. A split
  ///      that would grow the list past `segmentCap` reverts before any
  ///      write; removals that do not grow the list (edge trims and
  ///      full-segment deletions) always succeed.
  /// @param segments Live-support segment list to mutate.
  /// @param lower Lower path endpoint of the removed band.
  /// @param upper Upper path endpoint of the removed band.
  /// @param segmentCap Maximum number of stored segments after the removal.
  function removeBand(
    MarketTypes.PathSegment[] storage segments,
    int256 lower,
    int256 upper,
    uint256 segmentCap
  ) internal {
    // Validation only: an empty or inverted band reverts with EmptyBand.
    width(lower, upper);

    uint256 count = segments.length;
    for (uint256 i = 0; i < count; ++i) {
      MarketTypes.PathSegment storage segment = segments[i];
      if (segment.rLow > lower || upper > segment.rHigh) {
        continue;
      }

      bool keepsLowRemainder = lower > segment.rLow;
      bool keepsHighRemainder = upper < segment.rHigh;
      if (keepsLowRemainder && keepsHighRemainder) {
        if (count >= segmentCap) {
          revert SegmentCapExceeded(lower, upper, segmentCap);
        }
        int256 remainderHigh = segment.rHigh;
        segment.rHigh = lower;
        segments.push();
        for (uint256 j = count; j > i + 1; --j) {
          segments[j] = segments[j - 1];
        }
        segments[i + 1] = MarketTypes.PathSegment({rLow: upper, rHigh: remainderHigh});
      } else if (keepsLowRemainder) {
        segment.rHigh = lower;
      } else if (keepsHighRemainder) {
        segment.rLow = upper;
      } else {
        for (uint256 j = i + 1; j < count; ++j) {
          segments[j - 1] = segments[j];
        }
        segments.pop();
      }
      return;
    }

    revert BandOutsideLiveSupport(lower, upper);
  }

  /// @notice Restores the band `[lower, upper]` into a live-support segment
  ///   list, merging with a touching neighbor on either side — the inverse of
  ///   `removeBand`.
  /// @dev The list must be — and stays — ascending, disjoint, non-touching,
  ///      and positive-width; a band that overlaps a live segment reverts.
  ///      Deliberately no segment cap: a restore reinstates a band a prior
  ///      `removeBand` took (ADR 0014 P3's challenge path), and a valid
  ///      refutation must never fail on capacity. With withdrawal requests
  ///      serialized per receipt, restoring the pending request's bands
  ///      returns the list toward its pre-request shape, whose length the
  ///      removals already capped.
  /// @param segments Live-support segment list to mutate.
  /// @param lower Lower path endpoint of the restored band.
  /// @param upper Upper path endpoint of the restored band.
  function restoreBand(
    MarketTypes.PathSegment[] storage segments,
    int256 lower,
    int256 upper
  ) internal {
    // Validation only: an empty or inverted band reverts with EmptyBand.
    width(lower, upper);

    uint256 count = segments.length;
    uint256 insertAt = count;
    for (uint256 i = 0; i < count; ++i) {
      MarketTypes.PathSegment storage segment = segments[i];
      if (overlaps(segment.rLow, segment.rHigh, lower, upper)) {
        revert BandOverlapsLiveSupport(lower, upper);
      }
      // First segment at or right of the band; everything after it is
      // further right in an ascending list, so no later overlap is possible.
      if (segment.rLow >= upper) {
        insertAt = i;
        break;
      }
    }

    bool mergesLeft = insertAt > 0 && segments[insertAt - 1].rHigh == lower;
    bool mergesRight = insertAt < count && segments[insertAt].rLow == upper;
    if (mergesLeft && mergesRight) {
      segments[insertAt - 1].rHigh = segments[insertAt].rHigh;
      for (uint256 j = insertAt + 1; j < count; ++j) {
        segments[j - 1] = segments[j];
      }
      segments.pop();
    } else if (mergesLeft) {
      segments[insertAt - 1].rHigh = upper;
    } else if (mergesRight) {
      segments[insertAt].rLow = lower;
    } else {
      segments.push();
      for (uint256 j = count; j > insertAt; --j) {
        segments[j] = segments[j - 1];
      }
      segments[insertAt] = MarketTypes.PathSegment({rLow: lower, rHigh: upper});
    }
  }
}
