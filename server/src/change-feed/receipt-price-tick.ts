import { currentYesPriceCents } from "@popcharts/protocol/virtual-lmsr";
import { wadToNumber } from "@popcharts/protocol/wad";
import { RECEIPTS_STREAM, type PriceTickWire } from "@popcharts/live-channels";

/**
 * Builds the price tick a pregrad trade pushes onto its change-feed frame (repo
 * ADR 0021), computed once here, atomic with the receipt write. The price comes
 * from the shared virtual LMSR — the exact function the app derives a REST
 * price with — so a pushed point equals the one a full refetch would show.
 *
 * All share/parameter inputs are the market row's post-trade WAD-scaled values
 * (18 implied decimals), decoded to plain numbers with the shared protocol
 * `wadToNumber`/`wadToCents` — the same helpers the app decodes with, so the
 * pushed price cannot drift from a refetched one. A `receipt-price-tick` parity
 * test pins that equivalence.
 */

export function buildPriceTick(args: {
  t: Date;
  sequence: bigint;
  liquidityParameterWad: bigint;
  openingProbabilityWad: bigint;
  yesSharesWad: bigint;
  noSharesWad: bigint;
}): PriceTickWire {
  const yesPriceCents = currentYesPriceCents({
    b: wadToNumber(args.liquidityParameterWad),
    noShares: wadToNumber(args.noSharesWad),
    // Fractional, matching the unified read's replay (ADR 0025 P3): the
    // rounded-and-clamped wadToCents would make a pushed point disagree with
    // a refetched one for markets with fractional opening probabilities.
    openingProbability: wadToNumber(args.openingProbabilityWad) * 100,
    yesShares: wadToNumber(args.yesSharesWad),
  });

  return {
    t: args.t.toISOString(),
    stream: RECEIPTS_STREAM,
    sequence: Number(args.sequence),
    yesPriceCents,
    noPriceCents: 100 - yesPriceCents,
  };
}
