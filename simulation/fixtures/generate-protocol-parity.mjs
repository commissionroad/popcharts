import {
  computeMatchedMarketCap,
  normalizePathSegments,
  quoteWithdrawal,
  SIDE_NO,
  SIDE_YES,
} from "../../protocol/src/index.ts";
import {
  makeRng,
  randomWalkBook,
  WALK_LIQUIDITY_PARAMETER,
} from "../../protocol/test/nodejs/opposed-set-walk-fixtures.ts";

const coordinateUnit = WALK_LIQUIDITY_PARAMETER / 1_000_000n;
const rng = makeRng(0x0014_0601);
const books = [];

for (let trial = 0; trial < 64; trial += 1) {
  const book = randomWalkBook(rng, 4 + Math.floor(rng() * 37));
  const liveBook = book.map((receipt) => ({
    active: true,
    marketId: receipt.marketId,
    receiptId: receipt.receiptId,
    segments: [{ rHigh: receipt.rHigh, rLow: receipt.rLow }],
    side: receipt.side,
  }));
  const receipts = book.map((receipt) => {
    const quote = quoteWithdrawal({
      book: liveBook,
      feeRateWad: 0n,
      liquidityParameter: WALK_LIQUIDITY_PARAMETER,
      receiptId: receipt.receiptId,
    });
    return {
      freeCostInB: Number(quote.grossRefund) / Number(WALK_LIQUIDITY_PARAMETER),
      freeSegments: quote.freeSegments.map(({ rHigh, rLow }) => ({
        high: Number(rHigh / coordinateUnit),
        low: Number(rLow / coordinateUnit),
      })),
      high: Number(receipt.rHigh / coordinateUnit),
      id: Number(receipt.receiptId),
      low: Number(receipt.rLow / coordinateUnit),
      side:
        receipt.side === SIDE_YES ? "yes" : receipt.side === SIDE_NO ? "no" : "invalid",
    };
  });
  books.push({
    matchedMarketCap: Number(computeMatchedMarketCap(book) / coordinateUnit),
    receipts,
  });
}

console.log(
  JSON.stringify(
    {
      books,
      coordinateUnitsPerB: 1_000_000,
      generator: "protocol TypeScript withdrawal and clearing exports",
      schemaVersion: 1,
      seed: 0x0014_0601,
    },
    null,
    2,
  ),
);
