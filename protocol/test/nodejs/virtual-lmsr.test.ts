import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  costToBuyShares,
  createOpeningState,
  currentYesPriceCents,
  marginalPriceCents,
  sharesForBudget,
  stateAfterBudgetBuy,
  stateAfterBuy,
  yesProbability,
} from "../../src/price/virtualLmsr.js";

/** Vitest's `toBeCloseTo(expected, digits)` tolerance, restated for node:test. */
function assertCloseTo(actual: number, expected: number, digits: number) {
  const tolerance = 10 ** -digits / 2;
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

describe("virtual LMSR", function () {
  // Swept deterministically rather than with a property-based generator: this
  // package has no fast-check dependency, and a protocol-level invariant is
  // better pinned by a reproducible grid than by a seeded random one.
  it("opens at the requested probability across the parameter space", function () {
    for (const openingProbability of [5, 17, 35, 50, 66, 80, 95]) {
      for (const b of [500, 1_337, 5_000, 10_000]) {
        const state = createOpeningState({ b, openingProbability });

        assertCloseTo(yesProbability(state) * 100, openingProbability, 8);
      }
    }
  });

  it("raises the marginal YES price when YES is bought", function () {
    const state = createOpeningState({ b: 5_000, openingProbability: 50 });
    const before = marginalPriceCents(state, "yes");

    const after = marginalPriceCents(stateAfterBuy({ shares: 250, side: "yes", state }), "yes");

    assert.ok(after > before, `expected ${after} > ${before}`);
  });

  it("charges a positive path cost to buy shares", function () {
    const state = createOpeningState({ b: 3_000, openingProbability: 35 });

    assert.ok(costToBuyShares({ shares: 100, side: "no", state }) > 0);
  });

  it("spends close to the requested budget", function () {
    const state = createOpeningState({ b: 5_000, openingProbability: 50 });
    const shares = sharesForBudget({ budget: 100, side: "yes", state });

    assertCloseTo(costToBuyShares({ shares, side: "yes", state }), 100, 8);
  });

  it("moves the quoted side price on a budget buy", function () {
    const state = createOpeningState({ b: 5_000, openingProbability: 50 });
    const before = marginalPriceCents(state, "yes");

    const after = marginalPriceCents(
      stateAfterBudgetBuy({ budget: 100, side: "yes", state }),
      "yes",
    );

    assert.ok(after > before, `expected ${after} > ${before}`);
  });

  it("grows the bracket when the clamped opening price undershoots the cost", function () {
    // A very low opening probability with a large b keeps the marginal price
    // below the 0.01 clamp, so the initial bracket is too small to cover the
    // budget and must be doubled before bisecting.
    const state = createOpeningState({ b: 1_000_000, openingProbability: 0.5 });
    const shares = sharesForBudget({ budget: 100, side: "yes", state });

    assertCloseTo(costToBuyShares({ shares, side: "yes", state }), 100, 6);
  });

  it("quotes zero shares for a zero budget", function () {
    const state = createOpeningState({ b: 5_000, openingProbability: 50 });

    assert.equal(sharesForBudget({ budget: 0, side: "yes", state }), 0);
  });

  it("rejects negative share purchases", function () {
    const state = createOpeningState({ b: 5_000, openingProbability: 50 });

    assert.throws(
      () => costToBuyShares({ shares: -1, side: "yes", state }),
      /shares must be non-negative/,
    );
    assert.throws(
      () => stateAfterBuy({ shares: -1, side: "no", state }),
      /shares must be non-negative/,
    );
  });

  it("rejects non-finite or negative budgets", function () {
    const state = createOpeningState({ b: 5_000, openingProbability: 50 });

    assert.throws(
      () => sharesForBudget({ budget: Number.NaN, side: "yes", state }),
      /budget must be non-negative/,
    );
    assert.throws(
      () => sharesForBudget({ budget: -5, side: "no", state }),
      /budget must be non-negative/,
    );
  });

  it("rejects non-positive liquidity parameters", function () {
    assert.throws(() => yesProbability({ b: 0, noShares: 0, yesShares: 0 }), /b must be positive/);
    assert.throws(
      () => createOpeningState({ b: Number.NaN, openingProbability: 50 }),
      /b must be positive/,
    );
  });

  it("opens at the opening probability before any shares are bought", function () {
    for (const openingProbability of [20, 50, 73]) {
      assertCloseTo(
        currentYesPriceCents({
          b: 5_000,
          noShares: 0,
          openingProbability,
          yesShares: 0,
        }),
        openingProbability,
        8,
      );
    }
  });

  it("prices a market from its accumulated shares, matching the manual recipe", function () {
    // The whole reason this function exists: a caller must get the same price
    // whether it composes the primitives itself (the price-path replay) or
    // calls this (the live tick). Both routes must agree exactly.
    const args = {
      b: 5_000,
      noShares: 140,
      openingProbability: 50,
      yesShares: 320,
    };
    const manual = marginalPriceCents(
      stateAfterBuy({
        shares: args.noShares,
        side: "no",
        state: stateAfterBuy({
          shares: args.yesShares,
          side: "yes",
          state: createOpeningState({
            b: args.b,
            openingProbability: args.openingProbability,
          }),
        }),
      }),
      "yes",
    );

    assert.equal(currentYesPriceCents(args), manual);
  });

  it("rejects out-of-range opening probabilities", function () {
    for (const openingProbability of [0, 100, Number.NaN]) {
      assert.throws(
        () => createOpeningState({ b: 5_000, openingProbability }),
        /openingProbability must be between 0 and 100/,
      );
    }
  });
});
