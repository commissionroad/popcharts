import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { segmentsSidePathCost } from "../../src/clearing/opposed-set.js";
import {
  refuteWithdrawalClaim,
  verifyWithdrawalClaim,
  withdrawalChallengeCalldataBytes,
  withdrawalRequestCalldataBytes,
  type SegmentedReceipt,
  type WithdrawalClaim,
} from "../../src/clearing/withdrawal-claim.js";
import { SIDE_NO, SIDE_YES } from "../../src/market-side.js";
import { WAD, WALK_LIQUIDITY_PARAMETER } from "./opposed-set-walk-fixtures.js";

const B = WALK_LIQUIDITY_PARAMETER;

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

describe("verifyWithdrawalClaim", () => {
  it("accepts a contained claim and refunds its exact recorded path cost", () => {
    const receipt = yesReceipt();
    const claim = claimOf();
    const verification = verifyWithdrawalClaim({ claim, liquidityParameter: B, receipt });
    assert.equal(verification.refund, segmentsSidePathCost(claim.segments, SIDE_YES, B));
    assert.equal(verification.recordsLoaded, 5);
  });

  it("rejects segments outside the live support — including a withdrawn gap", () => {
    const receipt = yesReceipt({
      segments: [
        { rHigh: 20n * WAD, rLow: 0n },
        { rHigh: 100n * WAD, rLow: 60n * WAD },
      ],
    });
    assert.throws(
      () => verifyWithdrawalClaim({ claim: claimOf(), liquidityParameter: B, receipt }),
      /outside live support/,
    );
  });

  it("rejects unordered, overlapping, empty, and settled claims", () => {
    const unordered = claimOf({
      segments: [
        { rHigh: 40n * WAD, rLow: 30n * WAD },
        { rHigh: 20n * WAD, rLow: 10n * WAD },
      ],
    });
    assert.throws(
      () =>
        verifyWithdrawalClaim({ claim: unordered, liquidityParameter: B, receipt: yesReceipt() }),
      /unordered/,
    );
    assert.throws(
      () =>
        verifyWithdrawalClaim({
          claim: claimOf({ segments: [] }),
          liquidityParameter: B,
          receipt: yesReceipt(),
        }),
      /no segments/,
    );
    assert.throws(
      () =>
        verifyWithdrawalClaim({
          claim: claimOf(),
          liquidityParameter: B,
          receipt: yesReceipt({ active: false }),
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

  it("a colluding opposer's own pending withdrawal stays refutable both ways", () => {
    // A (YES) fraudulently claims segments actually opposed by B (NO); B then
    // claims the same region. Pending segments stay recorded until finalize,
    // so a challenger refutes A by naming B and B by naming A.
    const claimA = claimOf({
      receiptId: 7n,
      segments: [{ rHigh: 40n * WAD, rLow: 10n * WAD }],
      nextReceiptIdSnapshot: 9n,
    });
    const receiptB = yesReceipt({
      receiptId: 8n,
      segments: [{ rHigh: 35n * WAD, rLow: 20n * WAD }],
      side: SIDE_NO,
    });
    const claimB = claimOf({
      receiptId: 8n,
      segments: [{ rHigh: 35n * WAD, rLow: 20n * WAD }],
      nextReceiptIdSnapshot: 9n,
    });
    const receiptA = yesReceipt({ receiptId: 7n });

    assert.equal(
      refuteWithdrawalClaim({ claim: claimA, claimantSide: SIDE_YES, namedReceipt: receiptB })
        .refuted,
      true,
    );
    assert.equal(
      refuteWithdrawalClaim({ claim: claimB, claimantSide: SIDE_NO, namedReceipt: receiptA })
        .refuted,
      true,
    );
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
