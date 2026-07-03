/** The two share tallies from which matched market cap is derived. */
export type MatchedMarketCapInput = {
  noShares: bigint;
  yesShares: bigint;
};

/**
 * Matched market cap is the number of complete YES/NO sets, i.e.
 * min(yesShares, noShares). Only matched sets count toward the graduation
 * threshold; one-sided escrow is refundable and never inflates the cap.
 */
export function calculateMatchedMarketCap({
  noShares,
  yesShares,
}: MatchedMarketCapInput) {
  return minBigInt(yesShares, noShares);
}

function minBigInt(left: bigint, right: bigint) {
  return left < right ? left : right;
}
