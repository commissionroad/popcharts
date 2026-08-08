import { describe, expect, it } from "vitest";

import { entryFeeForCost, entryFeeRateFraction, totalDebitForCost } from "./entry-fee";
import { WAD } from "@/domain/tokens/wad";

const ONE_PERCENT_WAD = 10n ** 16n;

describe("entryFeeForCost", () => {
  it("charges nothing while the fee is disarmed", () => {
    expect(entryFeeForCost(100n * WAD, 0n)).toBe(0n);
  });

  it("mirrors the contract's floor division", () => {
    expect(entryFeeForCost(100n * WAD, ONE_PERCENT_WAD)).toBe(1n * WAD);
    // 150 wei at 1%: floor(150 * 1e16 / 1e18) = 1, never rounded up.
    expect(entryFeeForCost(150n, ONE_PERCENT_WAD)).toBe(1n);
    expect(entryFeeForCost(99n, ONE_PERCENT_WAD)).toBe(0n);
  });
});

describe("totalDebitForCost", () => {
  it("adds the fee to the cost", () => {
    expect(totalDebitForCost(100n * WAD, ONE_PERCENT_WAD)).toBe(101n * WAD);
  });

  it("is the identity while the fee is disarmed", () => {
    expect(totalDebitForCost(100n * WAD, 0n)).toBe(100n * WAD);
  });

  it("is monotone, so bounding a padded cost covers smaller executions", () => {
    const padded = totalDebitForCost(101n * WAD, ONE_PERCENT_WAD);
    const actual = totalDebitForCost(100n * WAD, ONE_PERCENT_WAD);
    expect(actual <= padded).toBe(true);
  });
});

describe("entryFeeRateFraction", () => {
  it("converts the WAD rate for display", () => {
    expect(entryFeeRateFraction(ONE_PERCENT_WAD)).toBe(0.01);
    expect(entryFeeRateFraction(0n)).toBe(0);
  });
});
