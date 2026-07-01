export type ReceiptBand = {
  rHigh: string;
  rLow: string;
  side: number;
};

type NormalizedReceiptBand = {
  high: bigint;
  low: bigint;
  side: 0 | 1;
};

export function calculateMatchedMarketCap(receipts: ReceiptBand[]) {
  const intervals = receipts.map(normalizeReceiptBand).filter(isDefined);

  if (intervals.length < 2) {
    return 0n;
  }

  const endpoints = Array.from(
    new Set(
      intervals.flatMap((interval) => [
        interval.low.toString(),
        interval.high.toString(),
      ]),
    ),
    BigInt,
  ).sort(compareBigInts);
  let matchedMarketCap = 0n;

  for (let index = 0; index < endpoints.length - 1; index += 1) {
    const left = endpoints[index] ?? 0n;
    const right = endpoints[index + 1] ?? 0n;
    const width = right - left;

    if (width <= 0n) {
      continue;
    }

    const coverage = countBandCoverage({ intervals, left, right });
    matchedMarketCap += width * minBigInt(coverage.yes, coverage.no);
  }

  return matchedMarketCap;
}

function normalizeReceiptBand(
  receipt: ReceiptBand,
): NormalizedReceiptBand | null {
  const rHigh = BigInt(receipt.rHigh);
  const rLow = BigInt(receipt.rLow);

  if (rHigh === rLow || (receipt.side !== 0 && receipt.side !== 1)) {
    return null;
  }

  return {
    high: rHigh > rLow ? rHigh : rLow,
    low: rHigh > rLow ? rLow : rHigh,
    side: receipt.side,
  };
}

function countBandCoverage({
  intervals,
  left,
  right,
}: {
  intervals: NormalizedReceiptBand[];
  left: bigint;
  right: bigint;
}) {
  let yes = 0n;
  let no = 0n;

  for (const interval of intervals) {
    if (interval.low > left || interval.high < right) {
      continue;
    }

    if (interval.side === 0) {
      yes += 1n;
    } else {
      no += 1n;
    }
  }

  return { no, yes };
}

function compareBigInts(left: bigint, right: bigint) {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
}

function minBigInt(left: bigint, right: bigint) {
  return left < right ? left : right;
}

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}
