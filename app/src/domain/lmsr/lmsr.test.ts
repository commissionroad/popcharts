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
});
