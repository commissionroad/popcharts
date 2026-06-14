export type MatchedMarketCapInput = {
  noShares: bigint;
  yesShares: bigint;
};

export function calculateMatchedMarketCap({
  noShares,
  yesShares,
}: MatchedMarketCapInput) {
  return minBigInt(yesShares, noShares);
}

function minBigInt(left: bigint, right: bigint) {
  return left < right ? left : right;
}
