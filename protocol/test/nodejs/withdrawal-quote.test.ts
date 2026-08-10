import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Everything under test is imported from the package surface (src/index.js)
// deliberately: P2's deliverable is the exported surface, so removing one of
// these exports fails this suite instead of silently narrowing the SDK.
import {
  quoteWithdrawal,
  segmentSidePathCost,
  segmentsSidePathCost,
  splitOpposedFree,
  yesBandCost,
  SIDE_NO,
  SIDE_YES,
  WAD,
  type SegmentedReceipt,
} from "../../src/index.js";
import {
  absDiff,
  CENT,
  rOfPercent,
  WALK_LIQUIDITY_PARAMETER,
  WITHDRAWAL_FEE_RATE_WAD,
} from "./opposed-set-walk-fixtures.js";

const B = WALK_LIQUIDITY_PARAMETER;

describe("quoteWithdrawal — whitepaper Example A at φ_out = 5% (ADR 0014 P2 golden)", () => {
  // b=100, open 20%. Alice YES 20→40, Noah NO 40→30, Bea YES 30→35.
  const r20 = rOfPercent(20);
  const r30 = rOfPercent(30);
  const r35 = rOfPercent(35);
  const r40 = rOfPercent(40);

  const alice = 1n;
  const noah = 2n;
  const bea = 3n;

  function exampleABook(): SegmentedReceipt[] {
    return [
      {
        active: true,
        marketId: 1n,
        receiptId: alice,
        segments: [{ rHigh: r40, rLow: r20 }],
        side: SIDE_YES,
      },
      {
        active: true,
        marketId: 1n,
        receiptId: noah,
        segments: [{ rHigh: r40, rLow: r30 }],
        side: SIDE_NO,
      },
      {
        active: true,
        marketId: 1n,
        receiptId: bea,
        segments: [{ rHigh: r35, rLow: r30 }],
        side: SIDE_YES,
      },
    ];
  }

  it("Alice: gross 13.35 returns 12.6825 net, penalty 0.6675", () => {
    const book = exampleABook();
    const quote = quoteWithdrawal({
      book,
      feeRateWad: WITHDRAWAL_FEE_RATE_WAD,
      liquidityParameter: B,
      receiptId: alice,
    });

    // The quote's free set is the split's free set, exactly.
    assert.deepEqual(
      quote.freeSegments.map(({ rHigh, rLow }) => ({ rHigh, rLow })),
      splitOpposedFree([{ rHigh: r40, rLow: r20 }], [{ rHigh: r40, rLow: r30 }]).free,
    );
    assert.deepEqual(
      quote.freeSegments.map(({ rHigh, rLow }) => ({ rHigh, rLow })),
      [{ rHigh: r30, rLow: r20 }],
    );

    // Exact bigint identities under the documented rounding: the fee is one
    // full-precision multiply, floor divide on the gross — at 5% that is
    // floor(gross/20), checked here by the independent route.
    assert.equal(quote.freeSegments[0]!.cost, yesBandCost(r20, r30, B));
    assert.equal(quote.grossRefund, quote.freeSegments[0]!.cost);
    assert.equal(quote.fee, quote.grossRefund / 20n);
    assert.equal(quote.netPayout + quote.fee, quote.grossRefund);

    // The paper's 4-decimal figures round the already-rounded 13.35, so they
    // sit within a cent of the exact arithmetic (net 12.685482…, fee
    // 0.667657…), not on it.
    assert.ok(absDiff(quote.grossRefund, 1335n * CENT) < CENT);
    assert.ok(absDiff(quote.netPayout, (126825n * WAD) / 10000n) < CENT);
    assert.ok(absDiff(quote.fee, (6675n * WAD) / 10000n) < CENT);
  });

  it("Noah and Bea: empty free set, zero quote", () => {
    const book = exampleABook();
    for (const receiptId of [noah, bea]) {
      assert.deepEqual(
        quoteWithdrawal({
          book,
          feeRateWad: WITHDRAWAL_FEE_RATE_WAD,
          liquidityParameter: B,
          receiptId,
        }),
        { fee: 0n, freeSegments: [], grossRefund: 0n, netPayout: 0n },
      );
    }
  });
});

describe("quoteWithdrawal — book semantics and rounding", () => {
  const whole = { rHigh: 10n * WAD, rLow: 0n };
  const middle = { rHigh: 6n * WAD, rLow: 4n * WAD };

  function bookWith(coverage: Partial<SegmentedReceipt>): SegmentedReceipt[] {
    return [
      { active: true, marketId: 1n, receiptId: 1n, segments: [whole], side: SIDE_YES },
      {
        active: true,
        marketId: 1n,
        receiptId: 2n,
        segments: [middle],
        side: SIDE_NO,
        ...coverage,
      },
    ];
  }

  it("prices each free fragment at its own recorded cost and sums exactly", () => {
    const quote = quoteWithdrawal({
      book: bookWith({}),
      feeRateWad: WITHDRAWAL_FEE_RATE_WAD,
      liquidityParameter: B,
      receiptId: 1n,
    });

    const fragments = [
      { rHigh: 4n * WAD, rLow: 0n },
      { rHigh: 10n * WAD, rLow: 6n * WAD },
    ];
    assert.deepEqual(
      quote.freeSegments.map(({ rHigh, rLow }) => ({ rHigh, rLow })),
      fragments,
    );
    quote.freeSegments.forEach((segment, index) => {
      assert.equal(segment.cost, segmentSidePathCost(fragments[index]!, SIDE_YES, B));
    });
    assert.equal(quote.grossRefund, segmentsSidePathCost(fragments, SIDE_YES, B));
  });

  it("floors the fee once on the gross, never per fragment", () => {
    // At a rate of WAD − 1 the two flooring orders differ by one wei for
    // these fragments, so this pins the documented convention rather than
    // restating the implementation.
    const feeRateWad = WAD - 1n;
    const quote = quoteWithdrawal({
      book: bookWith({}),
      feeRateWad,
      liquidityParameter: B,
      receiptId: 1n,
    });
    const [first, second] = quote.freeSegments;
    const perFragment = (first!.cost * feeRateWad) / WAD + (second!.cost * feeRateWad) / WAD;
    assert.equal(quote.fee, (quote.grossRefund * feeRateWad) / WAD);
    assert.notEqual(quote.fee, perFragment);
    assert.equal(quote.netPayout + quote.fee, quote.grossRefund);
  });

  it("quotes the exact gross at a zero rate and zero net at a 100% rate", () => {
    const zeroRate = quoteWithdrawal({
      book: bookWith({}),
      feeRateWad: 0n,
      liquidityParameter: B,
      receiptId: 1n,
    });
    assert.equal(zeroRate.fee, 0n);
    assert.equal(zeroRate.netPayout, zeroRate.grossRefund);

    const fullRate = quoteWithdrawal({
      book: bookWith({}),
      feeRateWad: WAD,
      liquidityParameter: B,
      receiptId: 1n,
    });
    assert.equal(fullRate.netPayout, 0n);
    assert.equal(fullRate.fee, fullRate.grossRefund);
  });

  it("rejects a fee rate outside [0, WAD] and unknown or settled receipts", () => {
    const book = bookWith({});
    const quoteArgs = { book, liquidityParameter: B, receiptId: 1n };
    assert.throws(
      () => quoteWithdrawal({ ...quoteArgs, feeRateWad: WAD + 1n }),
      /fee rate .* outside/,
    );
    assert.throws(() => quoteWithdrawal({ ...quoteArgs, feeRateWad: -1n }), /fee rate .* outside/);
    assert.throws(
      () => quoteWithdrawal({ book, feeRateWad: 0n, liquidityParameter: B, receiptId: 9n }),
      /Unknown receipt/,
    );
    const settled = bookWith({});
    settled[0] = { ...settled[0]!, active: false };
    assert.throws(
      () =>
        quoteWithdrawal({ book: settled, feeRateWad: 0n, liquidityParameter: B, receiptId: 1n }),
      /settled/,
    );
  });

  it("only live opposite-side coverage of the same market opposes", () => {
    const cases: Array<{ coverage: Partial<SegmentedReceipt>; opposes: boolean }> = [
      { coverage: {}, opposes: true },
      { coverage: { active: false }, opposes: false },
      { coverage: { marketId: 2n }, opposes: false },
      { coverage: { side: SIDE_YES }, opposes: false },
    ];
    for (const { coverage, opposes } of cases) {
      const quote = quoteWithdrawal({
        book: bookWith(coverage),
        feeRateWad: WITHDRAWAL_FEE_RATE_WAD,
        liquidityParameter: B,
        receiptId: 1n,
      });
      const expected = opposes
        ? [
            { rHigh: 4n * WAD, rLow: 0n },
            { rHigh: 10n * WAD, rLow: 6n * WAD },
          ]
        : [whole];
      assert.deepEqual(
        quote.freeSegments.map(({ rHigh, rLow }) => ({ rHigh, rLow })),
        expected,
      );
    }
  });
});
