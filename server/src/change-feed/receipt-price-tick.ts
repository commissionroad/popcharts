import { currentYesPriceCents } from "@popcharts/protocol/virtual-lmsr";
import type { PriceTickWire } from "@popcharts/live-channels";

/**
 * Builds the price tick a pregrad trade pushes onto its change-feed frame (repo
 * ADR 0021), computed once here, atomic with the receipt write. The price comes
 * from the shared virtual LMSR — the exact function the app derives a REST
 * price with — so a pushed point equals the one a full refetch would show.
 *
 * All share/parameter inputs are the market row's post-trade WAD-scaled values
 * (18 implied decimals). They are decoded to plain numbers here with the same
 * arithmetic the app's `wadToNumber`/`wadToCents` use; a `receipt-price-tick`
 * parity test pins that equivalence. (Unifying the two WAD helpers across the
 * app and server is a separate cleanup — see the file-naming-style backlog.)
 */

/** One whole unit in WAD fixed-point: 10^18. */
const WAD = 10n ** 18n;

/** WAD bigint → number, keeping the fractional part (matches the app helper). */
function wadToNumber(value: bigint): number {
  return Number(value / WAD) + Number(value % WAD) / Number(WAD);
}

/** WAD bigint → whole cents in [1, 99] (matches the app's opening-probability
 * decode: round half-up, then clamp away from the 0/100 asymptotes). */
function wadToCents(value: bigint): number {
  const cents = Number((value * 100n + WAD / 2n) / WAD);
  return Math.min(99, Math.max(1, cents));
}

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
    openingProbability: wadToCents(args.openingProbabilityWad),
    yesShares: wadToNumber(args.yesSharesWad),
  });

  return {
    t: args.t.toISOString(),
    sequence: Number(args.sequence),
    yesPriceCents,
    noPriceCents: 100 - yesPriceCents,
  };
}
