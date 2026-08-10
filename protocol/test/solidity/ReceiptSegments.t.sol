// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {ReceiptBook} from "../../contracts/ReceiptBook.sol";
import {ReceiptBands} from "../../contracts/libraries/ReceiptBands.sol";
import {MarketTypes} from "../../contracts/types/MarketTypes.sol";
import {ReceiptBookHarness} from "./harnesses/ReceiptBookHarness.sol";

contract ReceiptSegmentsTest is Test {
  int256 private constant WAD = 1e18;
  // Path coordinates in practice stay far below this; keeps fuzz arithmetic overflow-free.
  int256 private constant PATH_BOUND = 1e36;
  uint256 private constant FUZZ_REMOVALS = 12;

  ReceiptBookHarness private harness;

  function setUp() public {
    harness = new ReceiptBookHarness();
  }

  function _place(int256 rLow, int256 rHigh) private returns (uint256) {
    MarketTypes.PlaceReceiptParams memory params = MarketTypes.PlaceReceiptParams({
      marketId: 1,
      side: MarketTypes.Side.Yes,
      shares: uint256(rHigh - rLow),
      maxCost: type(uint256).max
    });
    MarketTypes.ReceiptQuote memory quote = MarketTypes.ReceiptQuote({
      cost: uint256(rHigh - rLow) / 2,
      rLow: rLow,
      rHigh: rHigh
    });
    return harness.place(params, quote);
  }

  function _assertSegments(uint256 receiptId, int256[2][] memory expected) private view {
    MarketTypes.PathSegment[] memory segments = harness.getReceiptSegments(receiptId);
    assertEq(segments.length, expected.length, "segment count");
    for (uint256 i = 0; i < expected.length; ++i) {
      assertEq(segments[i].rLow, expected[i][0], "segment rLow");
      assertEq(segments[i].rHigh, expected[i][1], "segment rHigh");
    }
  }

  function _segments1(int256 aLow, int256 aHigh) private pure returns (int256[2][] memory list) {
    list = new int256[2][](1);
    list[0] = [aLow, aHigh];
  }

  function _segments2(
    int256 aLow,
    int256 aHigh,
    int256 bLow,
    int256 bHigh
  ) private pure returns (int256[2][] memory list) {
    list = new int256[2][](2);
    list[0] = [aLow, aHigh];
    list[1] = [bLow, bHigh];
  }

  function test_SegmentCapMatchesAdrParameter() public view {
    assertEq(harness.MAX_RECEIPT_SEGMENTS(), 8);
  }

  function test_NeverWithdrawnReceiptReadsPlacementInterval() public {
    uint256 receiptId = _place(-2 * WAD, 3 * WAD);

    _assertSegments(receiptId, _segments1(-2 * WAD, 3 * WAD));
  }

  function test_GetReceiptSegmentsRevertsForUnknownReceipt() public {
    vm.expectRevert(abi.encodeWithSelector(ReceiptBook.ReceiptDoesNotExist.selector, 1));
    harness.getReceiptSegments(1);
  }

  function test_RemoveSupportBandRevertsForUnknownReceipt() public {
    vm.expectRevert(abi.encodeWithSelector(ReceiptBook.ReceiptDoesNotExist.selector, 7));
    harness.removeSupportBand(7, 0, WAD);
  }

  function test_InteriorRemovalSplitsThePlacementInterval() public {
    uint256 receiptId = _place(0, 10 * WAD);

    harness.removeSupportBand(receiptId, 2 * WAD, 5 * WAD);

    _assertSegments(receiptId, _segments2(0, 2 * WAD, 5 * WAD, 10 * WAD));

    // The placement record itself never changes; only live support shrinks.
    MarketTypes.Receipt memory receipt = harness.getReceipt(receiptId);
    assertEq(receipt.rLow, 0);
    assertEq(receipt.rHigh, 10 * WAD);
  }

  function test_EdgeRemovalsShrinkTheSegment() public {
    uint256 receiptId = _place(0, 10 * WAD);

    harness.removeSupportBand(receiptId, 0, 2 * WAD);
    _assertSegments(receiptId, _segments1(2 * WAD, 10 * WAD));

    harness.removeSupportBand(receiptId, 8 * WAD, 10 * WAD);
    _assertSegments(receiptId, _segments1(2 * WAD, 8 * WAD));
  }

  function test_FullRemovalEmptiesWithoutResurrectingThePlacementInterval() public {
    uint256 receiptId = _place(0, 10 * WAD);

    harness.removeSupportBand(receiptId, 0, 10 * WAD);

    // Empty live support must stay empty: the empty-list-means-placement
    // convention applies only before the first removal.
    MarketTypes.PathSegment[] memory segments = harness.getReceiptSegments(receiptId);
    assertEq(segments.length, 0);
  }

  function test_FullRemovalOfMiddleSegmentKeepsNeighbors() public {
    uint256 receiptId = _place(0, 10 * WAD);
    harness.removeSupportBand(receiptId, 2 * WAD, 3 * WAD);
    harness.removeSupportBand(receiptId, 5 * WAD, 6 * WAD);

    harness.removeSupportBand(receiptId, 3 * WAD, 5 * WAD);

    _assertSegments(receiptId, _segments2(0, 2 * WAD, 6 * WAD, 10 * WAD));
  }

  function test_RemovingEveryBandEmptiesTheSupport() public {
    uint256 receiptId = _place(0, 10 * WAD);
    harness.removeSupportBand(receiptId, 2 * WAD, 3 * WAD);

    harness.removeSupportBand(receiptId, 0, 2 * WAD);
    harness.removeSupportBand(receiptId, 3 * WAD, 10 * WAD);

    MarketTypes.PathSegment[] memory segments = harness.getReceiptSegments(receiptId);
    assertEq(segments.length, 0);
  }

  function test_BandAcrossAWithdrawnGapReverts() public {
    uint256 receiptId = _place(0, 10 * WAD);
    harness.removeSupportBand(receiptId, 2 * WAD, 5 * WAD);

    vm.expectRevert(
      abi.encodeWithSelector(ReceiptBands.BandOutsideLiveSupport.selector, WAD, 6 * WAD)
    );
    harness.removeSupportBand(receiptId, WAD, 6 * WAD);

    // Exactly the gap is outside live support too.
    vm.expectRevert(
      abi.encodeWithSelector(ReceiptBands.BandOutsideLiveSupport.selector, 2 * WAD, 5 * WAD)
    );
    harness.removeSupportBand(receiptId, 2 * WAD, 5 * WAD);
  }

  function test_BandOutsideThePlacementIntervalReverts() public {
    uint256 receiptId = _place(0, 10 * WAD);

    vm.expectRevert(
      abi.encodeWithSelector(ReceiptBands.BandOutsideLiveSupport.selector, -5 * WAD, -1 * WAD)
    );
    harness.removeSupportBand(receiptId, -5 * WAD, -1 * WAD);

    vm.expectRevert(
      abi.encodeWithSelector(ReceiptBands.BandOutsideLiveSupport.selector, 9 * WAD, 11 * WAD)
    );
    harness.removeSupportBand(receiptId, 9 * WAD, 11 * WAD);
  }

  function test_EmptyOrInvertedBandReverts() public {
    uint256 receiptId = _place(0, 10 * WAD);

    vm.expectRevert(abi.encodeWithSelector(ReceiptBands.EmptyBand.selector, 3 * WAD, 3 * WAD));
    harness.removeSupportBand(receiptId, 3 * WAD, 3 * WAD);

    vm.expectRevert(abi.encodeWithSelector(ReceiptBands.EmptyBand.selector, 5 * WAD, 3 * WAD));
    harness.removeSupportBand(receiptId, 5 * WAD, 3 * WAD);
  }

  /// Splits a fresh [0, 100 WAD] receipt up to the cap: seven interior
  /// removals leave eight live segments.
  function _placeAndFragmentToCap() private returns (uint256 receiptId) {
    receiptId = _place(0, 100 * WAD);
    for (uint256 i = 1; i <= 7; ++i) {
      int256 bandLow = int256(i) * 10 * WAD;
      harness.removeSupportBand(receiptId, bandLow, bandLow + WAD);
    }
    assertEq(harness.getReceiptSegments(receiptId).length, harness.MAX_RECEIPT_SEGMENTS());
  }

  function test_InteriorSplitPastTheCapReverts() public {
    uint256 receiptId = _placeAndFragmentToCap();

    vm.expectRevert(
      abi.encodeWithSelector(ReceiptBands.SegmentCapExceeded.selector, 80 * WAD, 81 * WAD, 8)
    );
    harness.removeSupportBand(receiptId, 80 * WAD, 81 * WAD);
  }

  function test_EdgeAndFullRemovalsStillSucceedAtTheCap() public {
    uint256 receiptId = _placeAndFragmentToCap();

    // Edge trim: never grows the list, so the cap does not apply.
    harness.removeSupportBand(receiptId, 71 * WAD, 72 * WAD);
    assertEq(harness.getReceiptSegments(receiptId).length, 8);

    // Full-segment removal frees room for an interior split again.
    harness.removeSupportBand(receiptId, 0, 10 * WAD);
    assertEq(harness.getReceiptSegments(receiptId).length, 7);

    harness.removeSupportBand(receiptId, 80 * WAD, 81 * WAD);
    assertEq(harness.getReceiptSegments(receiptId).length, 8);
  }

  /// Drives a random sequence of legal removals (full, edge, or interior when
  /// under the cap) and checks after every step that live support stays
  /// ascending, disjoint, non-touching, positive-width, inside the placement
  /// interval, capped, and exactly `placement width - removed width` wide.
  function testFuzz_LegalRemovalSequencePreservesInvariants(
    int256 lowerSeed,
    uint256 widthSeed,
    uint256 opSeed
  ) public {
    int256 rLow = bound(lowerSeed, -PATH_BOUND, PATH_BOUND - 100);
    int256 rHigh = rLow + int256(bound(widthSeed, 16, uint256(PATH_BOUND - rLow)));
    uint256 receiptId = _place(rLow, rHigh);
    uint256 liveWidth = uint256(rHigh - rLow);

    for (uint256 op = 0; op < FUZZ_REMOVALS; ++op) {
      MarketTypes.PathSegment[] memory segments = harness.getReceiptSegments(receiptId);
      if (segments.length == 0) break;

      opSeed = uint256(keccak256(abi.encode(opSeed)));
      MarketTypes.PathSegment memory segment = segments[opSeed % segments.length];
      (int256 bandLow, int256 bandHigh) = _pickLegalBand(
        segment,
        opSeed,
        segments.length >= harness.MAX_RECEIPT_SEGMENTS()
      );

      harness.removeSupportBand(receiptId, bandLow, bandHigh);
      liveWidth -= uint256(bandHigh - bandLow);

      _assertInvariants(receiptId, rLow, rHigh, liveWidth);
    }
  }

  /// Derives a legal removal band inside `segment` from `entropy`: one of
  /// full, low-edge, high-edge, or interior, degrading to narrower ops when
  /// the segment is too thin to cut or the cap forbids a split.
  function _pickLegalBand(
    MarketTypes.PathSegment memory segment,
    uint256 entropy,
    bool atCap
  ) private pure returns (int256 bandLow, int256 bandHigh) {
    uint256 segmentWidth = uint256(segment.rHigh - segment.rLow);
    uint256 kind = entropy % 4;
    if (kind == 3 && (atCap || segmentWidth < 3)) kind = entropy % 3;
    if (kind != 0 && segmentWidth < 2) kind = 0;

    uint256 cutEntropy = uint256(keccak256(abi.encode(entropy)));
    if (kind == 0) {
      return (segment.rLow, segment.rHigh);
    }
    if (kind == 1) {
      // Low edge: cut strictly inside the segment.
      int256 cut = segment.rLow + int256(1 + (cutEntropy % (segmentWidth - 1)));
      return (segment.rLow, cut);
    }
    if (kind == 2) {
      // High edge.
      int256 cut = segment.rLow + int256(1 + (cutEntropy % (segmentWidth - 1)));
      return (cut, segment.rHigh);
    }
    // Interior: both cuts strictly inside, positive width between them.
    int256 first = segment.rLow + int256(1 + (cutEntropy % (segmentWidth - 2)));
    uint256 headroom = uint256(segment.rHigh - first) - 1;
    int256 second = first + int256(1 + (uint256(keccak256(abi.encode(cutEntropy))) % headroom));
    return (first, second);
  }

  function _assertInvariants(
    uint256 receiptId,
    int256 rLow,
    int256 rHigh,
    uint256 expectedWidth
  ) private view {
    MarketTypes.PathSegment[] memory segments = harness.getReceiptSegments(receiptId);
    assertLe(segments.length, harness.MAX_RECEIPT_SEGMENTS(), "cap");

    uint256 totalWidth = 0;
    for (uint256 i = 0; i < segments.length; ++i) {
      assertGt(segments[i].rHigh, segments[i].rLow, "positive width");
      assertGe(segments[i].rLow, rLow, "inside placement interval");
      assertLe(segments[i].rHigh, rHigh, "inside placement interval");
      if (i > 0) {
        assertGt(segments[i].rLow, segments[i - 1].rHigh, "ascending, non-touching");
      }
      totalWidth += uint256(segments[i].rHigh - segments[i].rLow);
    }
    assertEq(totalWidth, expectedWidth, "width conservation");
  }
}
