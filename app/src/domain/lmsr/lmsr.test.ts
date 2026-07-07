import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  costToBuyShares,
  createOpeningState,
  marginalPriceCents,
  sharesForBudget,
  stateAfterBudgetBuy,
  stateAfterBuy,
  yesProbability,
} from "./lmsr";

describe("virtual LMSR", () => {
  test("opens at the requested probability", () => {
    fc.assert(
      fc.property(
        fc.integer({ max: 95, min: 5 }),
        fc.integer({ max: 10_000, min: 500 }),
        (openingProbability, b) => {
          const state = createOpeningState({ b, openingProbability });

          expect(yesProbability(state) * 100).toBeCloseTo(openingProbability, 8);
        }
      )
    );
  });

  test("buying YES raises the marginal YES price", () => {
    const state = createOpeningState({ b: 5_000, openingProbability: 50 });
    const before = marginalPriceCents(state, "yes");
    const after = marginalPriceCents(
      stateAfterBuy({ shares: 250, side: "yes", state }),
      "yes"
    );

    expect(after).toBeGreaterThan(before);
  });

  test("buying shares has a positive path cost", () => {
    const state = createOpeningState({ b: 3_000, openingProbability: 35 });

    expect(costToBuyShares({ shares: 100, side: "no", state })).toBeGreaterThan(0);
  });

  test("budget quotes spend close to the requested amount", () => {
    const state = createOpeningState({ b: 5_000, openingProbability: 50 });
    const shares = sharesForBudget({ budget: 100, side: "yes", state });

    expect(costToBuyShares({ shares, side: "yes", state })).toBeCloseTo(100, 8);
  });

  test("budget buys move the quoted side price", () => {
    const state = createOpeningState({ b: 5_000, openingProbability: 50 });
    const before = marginalPriceCents(state, "yes");
    const after = marginalPriceCents(
      stateAfterBudgetBuy({ budget: 100, side: "yes", state }),
      "yes"
    );

    expect(after).toBeGreaterThan(before);
  });

  test("rejects negative share purchases", () => {
    const state = createOpeningState({ b: 5_000, openingProbability: 50 });

    expect(() => costToBuyShares({ shares: -1, side: "yes", state })).toThrowError(
      "shares must be non-negative"
    );
    expect(() => stateAfterBuy({ shares: -1, side: "no", state })).toThrowError(
      "shares must be non-negative"
    );
  });

  test("rejects non-finite or negative budgets", () => {
    const state = createOpeningState({ b: 5_000, openingProbability: 50 });

    expect(() =>
      sharesForBudget({ budget: Number.NaN, side: "yes", state })
    ).toThrowError("budget must be non-negative");
    expect(() => sharesForBudget({ budget: -5, side: "no", state })).toThrowError(
      "budget must be non-negative"
    );
  });

  test("quotes zero shares for a zero budget", () => {
    const state = createOpeningState({ b: 5_000, openingProbability: 50 });

    expect(sharesForBudget({ budget: 0, side: "yes", state })).toBe(0);
  });

  test("grows the bracket when the clamped opening price undershoots the cost", () => {
    // A very low opening probability with a large b keeps the marginal price
    // below the 0.01 clamp, so the initial bracket is too small to cover the
    // budget and must be doubled before bisecting.
    const state = createOpeningState({ b: 1_000_000, openingProbability: 0.5 });
    const shares = sharesForBudget({ budget: 100, side: "yes", state });

    expect(costToBuyShares({ shares, side: "yes", state })).toBeCloseTo(100, 6);
  });

  test("rejects non-positive liquidity parameters", () => {
    expect(() => yesProbability({ b: 0, noShares: 0, yesShares: 0 })).toThrowError(
      "b must be positive"
    );
    expect(() =>
      createOpeningState({ b: Number.NaN, openingProbability: 50 })
    ).toThrowError("b must be positive");
  });

  test("rejects out-of-range opening probabilities", () => {
    expect(() => createOpeningState({ b: 5_000, openingProbability: 0 })).toThrowError(
      "openingProbability must be between 0 and 100"
    );
    expect(() =>
      createOpeningState({ b: 5_000, openingProbability: 100 })
    ).toThrowError("openingProbability must be between 0 and 100");
    expect(() =>
      createOpeningState({ b: 5_000, openingProbability: Number.NaN })
    ).toThrowError("openingProbability must be between 0 and 100");
  });
});
