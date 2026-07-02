import { formatUnits } from "viem";

/** Cron-parseable one-line result of one keeper pass over one market. */
export type KeeperRunSummary = {
  readonly arbAction: "buyAndMerge" | "hold" | "mintAndSell";
  readonly arbExecuted: boolean;
  readonly arbSkippedReason: string | null;
  readonly chainId: number;
  readonly deferredFound: number;
  readonly deferredRemaining: number;
  readonly deferredResolved: number;
  readonly market: string;
  readonly priceNo: string;
  readonly priceSum: string;
  readonly priceSumAfter: string | null;
  readonly priceYes: string;
};

/**
 * Shapes one keeper pass into the structured JSON summary the keeper prints
 * as its final line, validating count and price consistency so a buggy pass
 * fails loudly instead of emitting a misleading "all good" summary. All WAD
 * inputs are formatted as 18-decimal display strings.
 */
export function summarizeKeeperRun(args: {
  readonly arbAction: "buyAndMerge" | "hold" | "mintAndSell";
  readonly arbExecuted: boolean;
  readonly arbSkippedReason?: string;
  readonly chainId: number;
  readonly deferredFound: number;
  readonly deferredRemaining: number;
  readonly deferredResolved: number;
  readonly market: string;
  readonly noDisplayPriceWad: bigint;
  readonly priceSumAfterWad?: bigint;
  readonly yesDisplayPriceWad: bigint;
}): KeeperRunSummary {
  if (!Number.isSafeInteger(args.chainId) || args.chainId <= 0) {
    throw new Error(`Expected a positive chainId, received ${args.chainId}.`);
  }
  for (const [label, count] of [
    ["deferredFound", args.deferredFound],
    ["deferredRemaining", args.deferredRemaining],
    ["deferredResolved", args.deferredResolved],
  ] as const) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Expected ${label} to be a non-negative integer, received ${count}.`);
    }
  }
  if (args.deferredResolved + args.deferredRemaining !== args.deferredFound) {
    throw new Error(
      `Deferred counts do not reconcile: resolved ${args.deferredResolved} + ` +
        `remaining ${args.deferredRemaining} != found ${args.deferredFound}.`,
    );
  }
  if (args.yesDisplayPriceWad <= 0n || args.noDisplayPriceWad <= 0n) {
    throw new Error(
      `Expected positive display prices, received YES ${args.yesDisplayPriceWad} ` +
        `and NO ${args.noDisplayPriceWad}.`,
    );
  }
  if (args.arbExecuted && args.priceSumAfterWad === undefined) {
    throw new Error("An executed arbitrage pass must report priceSumAfterWad.");
  }
  if (args.arbExecuted && args.arbSkippedReason !== undefined) {
    throw new Error("An executed arbitrage pass cannot also carry a skip reason.");
  }

  return {
    arbAction: args.arbAction,
    arbExecuted: args.arbExecuted,
    arbSkippedReason: args.arbSkippedReason ?? null,
    chainId: args.chainId,
    deferredFound: args.deferredFound,
    deferredRemaining: args.deferredRemaining,
    deferredResolved: args.deferredResolved,
    market: args.market,
    priceNo: formatUnits(args.noDisplayPriceWad, 18),
    priceSum: formatUnits(args.yesDisplayPriceWad + args.noDisplayPriceWad, 18),
    priceSumAfter:
      args.priceSumAfterWad === undefined ? null : formatUnits(args.priceSumAfterWad, 18),
    priceYes: formatUnits(args.yesDisplayPriceWad, 18),
  };
}
