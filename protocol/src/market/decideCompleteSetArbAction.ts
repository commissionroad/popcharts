const WAD = 10n ** 18n;

/** Direction a complete-set arbitrage round trip should take, plus the observed price sum. */
export type CompleteSetArbDecision = {
  readonly action: "buyAndMerge" | "hold" | "mintAndSell";
  readonly priceSumWad: bigint;
};

/**
 * Decides the complete-set arbitrage direction from displayed YES and NO
 * prices (whitepaper complete-set economics): when YES + NO trades above one
 * full set, mint sets and sell both sides; when it trades below, buy both
 * sides and merge; within the tolerance band, hold. Prices must be positive
 * WAD display prices and the tolerance must be non-negative.
 */
export function decideCompleteSetArbAction(args: {
  readonly noDisplayPriceWad: bigint;
  readonly toleranceWad: bigint;
  readonly yesDisplayPriceWad: bigint;
}): CompleteSetArbDecision {
  if (args.yesDisplayPriceWad <= 0n || args.noDisplayPriceWad <= 0n) {
    throw new Error(
      `Expected positive display prices, received YES ${args.yesDisplayPriceWad} ` +
        `and NO ${args.noDisplayPriceWad}.`,
    );
  }
  if (args.toleranceWad < 0n) {
    throw new Error(`Expected a non-negative tolerance, received ${args.toleranceWad}.`);
  }

  const priceSumWad = args.yesDisplayPriceWad + args.noDisplayPriceWad;
  if (priceSumWad > WAD + args.toleranceWad) {
    return { action: "mintAndSell", priceSumWad };
  }
  if (priceSumWad < WAD - args.toleranceWad) {
    return { action: "buyAndMerge", priceSumWad };
  }
  return { action: "hold", priceSumWad };
}
