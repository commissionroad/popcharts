import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeMatchedMarketCap } from "../../src/clearing/band-pass-clearing.js";
import { segmentsSidePathCost } from "../../src/clearing/opposed-set.js";
import {
  refuteWithdrawalClaim,
  verifyWithdrawalRequest,
  WithdrawalRequestModel,
  withdrawalChallengeCalldataBytes,
  withdrawalRequestCalldataBytes,
  type SegmentedReceipt,
  type WithdrawalClaim,
} from "../../src/clearing/withdrawal-claim.js";
import { SIDE_NO, SIDE_YES } from "../../src/market-side.js";
import { WAD, WALK_LIQUIDITY_PARAMETER } from "./opposed-set-walk-fixtures.js";

const B = WALK_LIQUIDITY_PARAMETER;
const WINDOW = 100n;

function yesReceipt(overrides: Partial<SegmentedReceipt> = {}): SegmentedReceipt {
  return {
    active: true,
    marketId: 1n,
    receiptId: 7n,
    segments: [{ rHigh: 100n * WAD, rLow: 0n }],
    side: SIDE_YES,
    ...overrides,
  };
}

function claimOf(overrides: Partial<WithdrawalClaim> = {}): WithdrawalClaim {
  return {
    marketId: 1n,
    nextReceiptIdSnapshot: 10n,
    receiptId: 7n,
    segments: [{ rHigh: 40n * WAD, rLow: 10n * WAD }],
    ...overrides,
  };
}

describe("verifyWithdrawalRequest", () => {
  it("accepts a contained request and refunds its exact recorded path cost", () => {
    const receipt = yesReceipt();
    const request = { receiptId: 7n, segments: [{ rHigh: 40n * WAD, rLow: 10n * WAD }] };
    const verification = verifyWithdrawalRequest({ liquidityParameter: B, receipt, request });
    assert.equal(verification.refund, segmentsSidePathCost(request.segments, SIDE_YES, B));
    assert.equal(verification.recordsLoaded, 5);
  });

  it("rejects segments outside the live support — including a withdrawn gap", () => {
    const receipt = yesReceipt({
      segments: [
        { rHigh: 20n * WAD, rLow: 0n },
        { rHigh: 100n * WAD, rLow: 60n * WAD },
      ],
    });
    const request = { receiptId: 7n, segments: [{ rHigh: 40n * WAD, rLow: 10n * WAD }] };
    assert.throws(
      () => verifyWithdrawalRequest({ liquidityParameter: B, receipt, request }),
      /outside live support/,
    );
  });

  it("rejects unordered, overlapping, empty, and settled requests", () => {
    const unordered = {
      receiptId: 7n,
      segments: [
        { rHigh: 40n * WAD, rLow: 30n * WAD },
        { rHigh: 20n * WAD, rLow: 10n * WAD },
      ],
    };
    assert.throws(
      () =>
        verifyWithdrawalRequest({
          liquidityParameter: B,
          receipt: yesReceipt(),
          request: unordered,
        }),
      /unordered/,
    );
    assert.throws(
      () =>
        verifyWithdrawalRequest({
          liquidityParameter: B,
          receipt: yesReceipt(),
          request: { receiptId: 7n, segments: [] },
        }),
      /no segments/,
    );
    assert.throws(
      () =>
        verifyWithdrawalRequest({
          liquidityParameter: B,
          receipt: yesReceipt({ active: false }),
          request: { receiptId: 7n, segments: [{ rHigh: 40n * WAD, rLow: 10n * WAD }] },
        }),
      /settled/,
    );
  });
});

describe("refuteWithdrawalClaim", () => {
  const claim = claimOf();

  it("one overlapping live opposite-side receipt refutes the claim", () => {
    const counterexample = yesReceipt({
      receiptId: 3n,
      segments: [{ rHigh: 15n * WAD, rLow: 5n * WAD }],
      side: SIDE_NO,
    });
    const result = refuteWithdrawalClaim({
      claim,
      claimantSide: SIDE_YES,
      namedReceipt: counterexample,
    });
    assert.equal(result.refuted, true);
    assert.equal(result.recordsLoaded, 9);
  });

  it("same side, other market, settled, or non-overlapping receipts do not", () => {
    const base = {
      receiptId: 3n,
      segments: [{ rHigh: 15n * WAD, rLow: 5n * WAD }],
      side: SIDE_NO,
    };
    const cases: SegmentedReceipt[] = [
      yesReceipt({ ...base, side: SIDE_YES }),
      yesReceipt({ ...base, marketId: 2n }),
      yesReceipt({ ...base, active: false }),
      yesReceipt({ ...base, segments: [{ rHigh: 90n * WAD, rLow: 50n * WAD }] }),
      // Touching the claimed segment's endpoint shares no band.
      yesReceipt({ ...base, segments: [{ rHigh: 10n * WAD, rLow: 5n * WAD }] }),
    ];
    for (const namedReceipt of cases) {
      assert.equal(
        refuteWithdrawalClaim({ claim, claimantSide: SIDE_YES, namedReceipt }).refuted,
        false,
      );
    }
  });

  it("coverage placed after the request snapshot cannot refute", () => {
    // The honest-withdrawal protection: the claimed segments left the live
    // book at request time, so later opposition is not opposition of them.
    const lateArrival = yesReceipt({
      receiptId: 10n,
      segments: [{ rHigh: 15n * WAD, rLow: 5n * WAD }],
      side: SIDE_NO,
    });
    assert.equal(
      refuteWithdrawalClaim({ claim, claimantSide: SIDE_YES, namedReceipt: lateArrival }).refuted,
      false,
    );
  });
});

describe("WithdrawalRequestModel", () => {
  const band = { rHigh: 40n * WAD, rLow: 10n * WAD };

  /** One opposed band: YES and NO both cover it, so it contributes w to F. */
  function opposedPair() {
    const model = new WithdrawalRequestModel({
      challengeWindow: WINDOW,
      liquidityParameter: B,
      marketId: 1n,
    });
    const yes = model.addReceipt({ segments: [band], side: SIDE_YES });
    const no = model.addReceipt({ segments: [band], side: SIDE_NO });
    return { model, no, yes };
  }

  function matchedCap(
    model: WithdrawalRequestModel,
    receiptIds: bigint[],
    sides: number[],
  ): bigint {
    return computeMatchedMarketCap(
      receiptIds.flatMap((receiptId, index) =>
        model.liveSegments(receiptId).map((segment) => ({ ...segment, side: sides[index]! })),
      ),
    );
  }

  it("honest flow: request removes live support, finalize pays after the window", () => {
    const model = new WithdrawalRequestModel({
      challengeWindow: WINDOW,
      liquidityParameter: B,
      marketId: 1n,
    });
    const lone = model.addReceipt({ segments: [{ rHigh: 100n * WAD, rLow: 0n }], side: SIDE_YES });

    const requestId = model.requestWithdrawal(lone, [band], 0n);
    assert.deepEqual(model.liveSegments(lone), [
      { rHigh: 10n * WAD, rLow: 0n },
      { rHigh: 100n * WAD, rLow: 40n * WAD },
    ]);

    assert.throws(() => model.finalize(requestId, WINDOW - 1n), /before its challenge deadline/);
    // Challenges are strict-interior: the deadline itself is finalize
    // territory, not challenge territory.
    assert.throws(() => model.challenge(requestId, lone, WINDOW), /window closed/);

    const refund = model.finalize(requestId, WINDOW);
    assert.equal(refund, segmentsSidePathCost([band], SIDE_YES, B));
    assert.equal(model.request(requestId).state, "finalized");
    assert.throws(() => model.challenge(requestId, lone, WINDOW - 1n), /finalized/);
  });

  it("collusion chain: both false claims are refutable in order and F survives", () => {
    const { model, no, yes } = opposedPair();
    const capBefore = matchedCap(model, [yes, no], [SIDE_YES, SIDE_NO]);
    assert.equal(capBefore, band.rHigh - band.rLow);

    // (1) YES falsely requests its opposed band — structural checks pass,
    // opposition is deliberately not checked at request time.
    const requestYes = model.requestWithdrawal(yes, [band], 0n);
    assert.deepEqual(model.liveSegments(yes), []);
    // (2) Same block, the colluding NO requests the same band: the live book
    // now shows no YES coverage there, and the request also passes.
    const requestNo = model.requestWithdrawal(no, [band], 0n);
    assert.deepEqual(model.liveSegments(no), []);

    // (a) The dependent claim can never finalize while the enabling claim is
    // still challengeable: equal deadlines, and finalize needs the deadline.
    assert.throws(() => model.finalize(requestNo, WINDOW - 1n), /before its challenge deadline/);

    // (b) At window-minus-one a challenger refutes YES by naming NO — NO's
    // coverage of the band is pending-recorded, not live. The refutation
    // restores YES's segments.
    const refuteYes = model.challenge(requestYes, no, WINDOW - 1n);
    assert.equal(refuteYes.refuted, true);
    assert.deepEqual(model.liveSegments(yes), [band]);

    // (c) Then NO's claim falls to the now-live YES coverage.
    const refuteNo = model.challenge(requestNo, yes, WINDOW - 1n);
    assert.equal(refuteNo.refuted, true);
    assert.deepEqual(model.liveSegments(no), [band]);

    assert.equal(model.request(requestYes).state, "challenged");
    assert.equal(model.request(requestNo).state, "challenged");
    assert.throws(() => model.finalize(requestNo, WINDOW), /challenged/);
    assert.equal(matchedCap(model, [yes, no], [SIDE_YES, SIDE_NO]), capBefore);
  });

  it("collusion chain: the reverse challenge order works too", () => {
    const { model, no, yes } = opposedPair();
    const capBefore = matchedCap(model, [yes, no], [SIDE_YES, SIDE_NO]);
    const requestYes = model.requestWithdrawal(yes, [band], 0n);
    const requestNo = model.requestWithdrawal(no, [band], 0n);

    // Refute NO first: YES's coverage is pending-recorded at this point.
    assert.equal(model.challenge(requestNo, yes, WINDOW - 1n).refuted, true);
    // Then YES's claim falls to the restored, now-live NO coverage.
    assert.equal(model.challenge(requestYes, no, WINDOW - 1n).refuted, true);

    assert.deepEqual(model.liveSegments(yes), [band]);
    assert.deepEqual(model.liveSegments(no), [band]);
    assert.equal(matchedCap(model, [yes, no], [SIDE_YES, SIDE_NO]), capBefore);
  });

  it("collusion chain: NO requesting first is symmetric", () => {
    const { model, no, yes } = opposedPair();
    const capBefore = matchedCap(model, [yes, no], [SIDE_YES, SIDE_NO]);
    const requestNo = model.requestWithdrawal(no, [band], 0n);
    const requestYes = model.requestWithdrawal(yes, [band], 0n);

    assert.throws(() => model.finalize(requestYes, WINDOW - 1n), /before its challenge deadline/);
    assert.equal(model.challenge(requestNo, yes, WINDOW - 1n).refuted, true);
    assert.equal(model.challenge(requestYes, no, WINDOW - 1n).refuted, true);
    assert.equal(matchedCap(model, [yes, no], [SIDE_YES, SIDE_NO]), capBefore);
  });

  it("unchallenged collusion extracts the band — the honest-watcher residual", () => {
    const { model, no, yes } = opposedPair();
    const requestYes = model.requestWithdrawal(yes, [band], 0n);
    const requestNo = model.requestWithdrawal(no, [band], 0n);

    assert.equal(model.finalize(requestYes, WINDOW), segmentsSidePathCost([band], SIDE_YES, B));
    assert.equal(model.finalize(requestNo, WINDOW), segmentsSidePathCost([band], SIDE_NO, B));
    // Both sides collected the band's recorded cost and F dropped by its
    // width: exactly the failure the challenge window (or the v1 attester)
    // must prevent.
    assert.equal(matchedCap(model, [yes, no], [SIDE_YES, SIDE_NO]), 0n);
  });

  it("stamps the snapshot itself: coverage placed after a request cannot refute", () => {
    const model = new WithdrawalRequestModel({
      challengeWindow: WINDOW,
      liquidityParameter: B,
      marketId: 1n,
    });
    const yes = model.addReceipt({ segments: [band], side: SIDE_YES });
    const requestId = model.requestWithdrawal(yes, [band], 0n);

    // An opposing receipt arriving during the window overlaps the claimed
    // band but sits at or above the stamped snapshot — not a refutation.
    const late = model.addReceipt({ segments: [band], side: SIDE_NO });
    assert.equal(model.challenge(requestId, late, WINDOW - 1n).refuted, false);
    assert.equal(model.request(requestId).state, "pending");
    assert.equal(model.finalize(requestId, WINDOW), segmentsSidePathCost([band], SIDE_YES, B));
  });

  it("later requests never finalize before earlier deadlines", () => {
    const { model, no, yes } = opposedPair();
    model.requestWithdrawal(yes, [band], 0n);
    const requestNo = model.requestWithdrawal(no, [band], 10n);

    assert.equal(model.request(requestNo).deadline, 10n + WINDOW);
    assert.throws(() => model.finalize(requestNo, WINDOW + 5n), /before its challenge deadline/);
    assert.equal(model.finalize(requestNo, WINDOW + 10n), segmentsSidePathCost([band], SIDE_NO, B));
    assert.throws(() => model.requestWithdrawal(yes, [band], 5n), /Time ran backwards/);
  });
});

describe("withdrawal claim calldata", () => {
  it("request and challenge calldata stay flat and small", () => {
    assert.equal(withdrawalRequestCalldataBytes(1), 164);
    assert.equal(withdrawalRequestCalldataBytes(2), 228);
    assert.equal(withdrawalRequestCalldataBytes(4), 356);
    assert.equal(withdrawalChallengeCalldataBytes(), 68);
  });
});
