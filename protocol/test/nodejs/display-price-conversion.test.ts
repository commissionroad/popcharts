import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { alignTickToSpacing } from "../../scripts/shared/price/alignTickToSpacing.js";
import { clampDisplayPriceWad } from "../../scripts/shared/price/clampDisplayPriceWad.js";
import { COMPLETE_SET_PRICE_POLICY } from "../../scripts/shared/price/completeSetPricePolicy.js";
import { deriveEpsilonBoundTicks } from "../../scripts/shared/price/deriveEpsilonBoundTicks.js";
import { displayPriceWadToSqrtPriceX96 } from "../../scripts/shared/price/displayPriceWadToSqrtPriceX96.js";
import { displayPriceWadToTick } from "../../scripts/shared/price/displayPriceWadToTick.js";
import { parseDisplayPriceWad } from "../../scripts/shared/price/parseDisplayPriceWad.js";
import { sqrtPriceX96ToTick } from "../../scripts/shared/price/sqrtPriceX96ToTick.js";
import { tickToDisplayPriceWad } from "../../scripts/shared/price/tickToDisplayPriceWad.js";
import {
  MAX_TICK,
  MIN_TICK,
  tickToSqrtPriceX96,
} from "../../scripts/shared/price/tickToSqrtPriceX96.js";

const WAD = 10n ** 18n;
const HALF_WAD = WAD / 2n;

// Golden fixtures cover both currency sort orders for the two collateral
// setups ADR 0009 cares about: 6-decimal Arc-USDC-style collateral and the
// 18-decimal local mock, always against 18-decimal outcome tokens.
const USDC_OUTCOME_IS_CURRENCY0 = {
  collateralDecimals: 6,
  outcomeDecimals: 18,
  outcomeIsCurrency0: true,
} as const;
const USDC_COLLATERAL_IS_CURRENCY0 = {
  collateralDecimals: 6,
  outcomeDecimals: 18,
  outcomeIsCurrency0: false,
} as const;
const MOCK_OUTCOME_IS_CURRENCY0 = {
  collateralDecimals: 18,
  outcomeDecimals: 18,
  outcomeIsCurrency0: true,
} as const;
const MOCK_COLLATERAL_IS_CURRENCY0 = {
  collateralDecimals: 18,
  outcomeDecimals: 18,
  outcomeIsCurrency0: false,
} as const;

describe("tickToSqrtPriceX96", function () {
  it("matches the published v4-core TickMath anchor values", function () {
    assert.equal(tickToSqrtPriceX96(0), 79228162514264337593543950336n);
    assert.equal(tickToSqrtPriceX96(MIN_TICK), 4295128739n);
    assert.equal(tickToSqrtPriceX96(MAX_TICK), 1461446703485210103287273052203988822378723970342n);
  });

  it("rejects ticks outside the TickMath range", function () {
    assert.throws(() => tickToSqrtPriceX96(MIN_TICK - 1), /outside the TickMath range/);
    assert.throws(() => tickToSqrtPriceX96(MAX_TICK + 1), /outside the TickMath range/);
    assert.throws(() => tickToSqrtPriceX96(0.5), /outside the TickMath range/);
  });
});

describe("sqrtPriceX96ToTick", function () {
  it("round-trips exact tick prices and floors prices between ticks", function () {
    for (const tick of [MIN_TICK, -283260, -6932, -60, -1, 0, 1, 60, 6931, 283260, MAX_TICK - 1]) {
      assert.equal(sqrtPriceX96ToTick(tickToSqrtPriceX96(tick)), tick);
      // One raw unit below the next tick's price still floors to this tick.
      assert.equal(sqrtPriceX96ToTick(tickToSqrtPriceX96(tick + 1) - 1n), tick);
    }
  });

  it("rejects sqrt prices outside the TickMath range", function () {
    assert.throws(() => sqrtPriceX96ToTick(4295128738n), /outside the TickMath range/);
    assert.throws(
      () => sqrtPriceX96ToTick(1461446703485210103287273052203988822378723970342n),
      /outside the TickMath range/,
    );
  });
});

describe("displayPriceWadToSqrtPriceX96", function () {
  it("converts 0.5 for 6-decimal collateral with the outcome token as currency0", function () {
    // Raw price = 0.5 * 10^(6-18); golden floor tick -283256.
    assert.equal(
      displayPriceWadToSqrtPriceX96({ ...USDC_OUTCOME_IS_CURRENCY0, displayPriceWad: HALF_WAD }),
      56022770974786139918731n,
    );
  });

  it("inverts 0.5 for 6-decimal collateral when collateral is currency0", function () {
    // Raw price = 2 * 10^(18-6); golden floor tick 283255.
    assert.equal(
      displayPriceWadToSqrtPriceX96({
        ...USDC_COLLATERAL_IS_CURRENCY0,
        displayPriceWad: HALF_WAD,
      }),
      112045541949572279837463876454916343n,
    );
  });

  it("converts 0.5 for 18-decimal mock collateral in both sort orders", function () {
    assert.equal(
      displayPriceWadToSqrtPriceX96({ ...MOCK_OUTCOME_IS_CURRENCY0, displayPriceWad: HALF_WAD }),
      56022770974786139918731938227n,
    );
    assert.equal(
      displayPriceWadToSqrtPriceX96({
        ...MOCK_COLLATERAL_IS_CURRENCY0,
        displayPriceWad: HALF_WAD,
      }),
      112045541949572279837463876454n,
    );
  });

  it("rejects non-positive prices and unsupported decimals", function () {
    assert.throws(
      () => displayPriceWadToSqrtPriceX96({ ...MOCK_OUTCOME_IS_CURRENCY0, displayPriceWad: 0n }),
      /must be positive/,
    );
    assert.throws(
      () =>
        displayPriceWadToSqrtPriceX96({
          collateralDecimals: 78,
          outcomeDecimals: 18,
          outcomeIsCurrency0: true,
          displayPriceWad: HALF_WAD,
        }),
      /collateralDecimals/,
    );
  });
});

describe("displayPriceWadToTick", function () {
  it("floors and ceils around 0.5 for 6-decimal collateral, outcome currency0", function () {
    const args = { ...USDC_OUTCOME_IS_CURRENCY0, displayPriceWad: HALF_WAD };
    assert.equal(displayPriceWadToTick({ ...args, rounding: "down" }), -283256);
    assert.equal(displayPriceWadToTick({ ...args, rounding: "up" }), -283255);
  });

  it("mirrors the tick when collateral sorts as currency0", function () {
    const args = { ...USDC_COLLATERAL_IS_CURRENCY0, displayPriceWad: HALF_WAD };
    assert.equal(displayPriceWadToTick({ ...args, rounding: "down" }), 283255);
    assert.equal(displayPriceWadToTick({ ...args, rounding: "up" }), 283256);
  });

  it("floors and ceils around 0.5 for 18-decimal mock collateral in both orders", function () {
    const outcome0 = { ...MOCK_OUTCOME_IS_CURRENCY0, displayPriceWad: HALF_WAD };
    assert.equal(displayPriceWadToTick({ ...outcome0, rounding: "down" }), -6932);
    assert.equal(displayPriceWadToTick({ ...outcome0, rounding: "up" }), -6931);

    const collateral0 = { ...MOCK_COLLATERAL_IS_CURRENCY0, displayPriceWad: HALF_WAD };
    assert.equal(displayPriceWadToTick({ ...collateral0, rounding: "down" }), 6931);
    assert.equal(displayPriceWadToTick({ ...collateral0, rounding: "up" }), 6932);
  });

  it("does not step up when the price sits exactly on a tick", function () {
    // Display price 1 with equal decimals is raw price 1, exactly tick 0.
    const args = { ...MOCK_OUTCOME_IS_CURRENCY0, displayPriceWad: WAD };
    assert.equal(displayPriceWadToTick({ ...args, rounding: "down" }), 0);
    assert.equal(displayPriceWadToTick({ ...args, rounding: "up" }), 0);
  });

  it("converts the epsilon prices for 6-decimal collateral, outcome currency0", function () {
    const minArgs = {
      ...USDC_OUTCOME_IS_CURRENCY0,
      displayPriceWad: COMPLETE_SET_PRICE_POLICY.minDisplayPriceWad,
    };
    assert.equal(displayPriceWadToTick({ ...minArgs, rounding: "down" }), -345406);
    assert.equal(displayPriceWadToTick({ ...minArgs, rounding: "up" }), -345405);

    const maxArgs = {
      ...USDC_OUTCOME_IS_CURRENCY0,
      displayPriceWad: COMPLETE_SET_PRICE_POLICY.maxDisplayPriceWad,
    };
    assert.equal(displayPriceWadToTick({ ...maxArgs, rounding: "down" }), -276335);
    assert.equal(displayPriceWadToTick({ ...maxArgs, rounding: "up" }), -276334);
  });
});

describe("tickToDisplayPriceWad", function () {
  it("brackets 0.5 across the displayPriceWadToTick golden ticks in every orientation", function () {
    // Mirrors the displayPriceWadToTick fixtures: the floor tick prices at or
    // below 0.5 WAD and the ceil tick at or above it.
    assert.equal(
      tickToDisplayPriceWad({ ...USDC_OUTCOME_IS_CURRENCY0, tick: -283256 }),
      499992241098655015n,
    );
    assert.equal(
      tickToDisplayPriceWad({ ...USDC_OUTCOME_IS_CURRENCY0, tick: -283255 }),
      500042240322764880n,
    );
    assert.equal(
      tickToDisplayPriceWad({ ...USDC_COLLATERAL_IS_CURRENCY0, tick: 283255 }),
      500042240322764880n,
    );
    assert.equal(
      tickToDisplayPriceWad({ ...USDC_COLLATERAL_IS_CURRENCY0, tick: 283256 }),
      499992241098655015n,
    );
    assert.equal(
      tickToDisplayPriceWad({ ...MOCK_OUTCOME_IS_CURRENCY0, tick: -6932 }),
      499990919207187760n,
    );
    assert.equal(
      tickToDisplayPriceWad({ ...MOCK_COLLATERAL_IS_CURRENCY0, tick: 6931 }),
      500040918299108479n,
    );
  });

  it("is exact where the raw price is exactly representable", function () {
    // Display price 1 with equal decimals is raw price 1, exactly tick 0.
    assert.equal(tickToDisplayPriceWad({ ...MOCK_OUTCOME_IS_CURRENCY0, tick: 0 }), WAD);
    assert.equal(tickToDisplayPriceWad({ ...MOCK_COLLATERAL_IS_CURRENCY0, tick: 0 }), WAD);
  });

  it("round-trips through displayPriceWadToTick as its inverse", function () {
    for (const orientation of [
      USDC_OUTCOME_IS_CURRENCY0,
      USDC_COLLATERAL_IS_CURRENCY0,
      MOCK_OUTCOME_IS_CURRENCY0,
      MOCK_COLLATERAL_IS_CURRENCY0,
    ]) {
      for (const tick of [-283260, -6960, -60, 60, 6960, 283260]) {
        const displayPriceWad = tickToDisplayPriceWad({ ...orientation, tick });
        // Truncation in the display conversion can land the price a hair
        // below the exact tick price, so the tick sits within one rounding
        // step in either direction.
        const down = displayPriceWadToTick({ ...orientation, displayPriceWad, rounding: "down" });
        const up = displayPriceWadToTick({ ...orientation, displayPriceWad, rounding: "up" });
        assert.ok(down <= tick && tick <= up + 1, `tick ${tick} escaped [${down}, ${up + 1}]`);
      }
    }
  });

  it("moves display price with tick according to the currency sort order", function () {
    // Collateral per outcome token rises with tick when the outcome token is
    // currency0 and falls with tick when it is currency1.
    assert.ok(
      tickToDisplayPriceWad({ ...MOCK_OUTCOME_IS_CURRENCY0, tick: 60 }) >
        tickToDisplayPriceWad({ ...MOCK_OUTCOME_IS_CURRENCY0, tick: 0 }),
    );
    assert.ok(
      tickToDisplayPriceWad({ ...MOCK_COLLATERAL_IS_CURRENCY0, tick: 60 }) <
        tickToDisplayPriceWad({ ...MOCK_COLLATERAL_IS_CURRENCY0, tick: 0 }),
    );
  });
});

describe("deriveEpsilonBoundTicks", function () {
  it("derives spacing-aligned bounds for 6-decimal collateral in both orders", function () {
    assert.deepEqual(deriveEpsilonBoundTicks(USDC_OUTCOME_IS_CURRENCY0), {
      lowerTick: -345420,
      upperTick: -276300,
    });
    assert.deepEqual(deriveEpsilonBoundTicks(USDC_COLLATERAL_IS_CURRENCY0), {
      lowerTick: 276300,
      upperTick: 345420,
    });
  });

  it("derives spacing-aligned bounds for 18-decimal mock collateral in both orders", function () {
    assert.deepEqual(deriveEpsilonBoundTicks(MOCK_OUTCOME_IS_CURRENCY0), {
      lowerTick: -69120,
      upperTick: 0,
    });
    assert.deepEqual(deriveEpsilonBoundTicks(MOCK_COLLATERAL_IS_CURRENCY0), {
      lowerTick: 0,
      upperTick: 69120,
    });
  });

  it("never narrows the epsilon display-price range", function () {
    for (const orientation of [
      USDC_OUTCOME_IS_CURRENCY0,
      USDC_COLLATERAL_IS_CURRENCY0,
      MOCK_OUTCOME_IS_CURRENCY0,
      MOCK_COLLATERAL_IS_CURRENCY0,
    ]) {
      const { lowerTick, upperTick } = deriveEpsilonBoundTicks(orientation);
      assert.ok(lowerTick % COMPLETE_SET_PRICE_POLICY.tickSpacing === 0);
      assert.ok(upperTick % COMPLETE_SET_PRICE_POLICY.tickSpacing === 0);
      assert.ok(lowerTick < upperTick);

      for (const displayPriceWad of [
        COMPLETE_SET_PRICE_POLICY.minDisplayPriceWad,
        COMPLETE_SET_PRICE_POLICY.maxDisplayPriceWad,
      ]) {
        const sqrtPriceX96 = displayPriceWadToSqrtPriceX96({ ...orientation, displayPriceWad });
        assert.ok(tickToSqrtPriceX96(lowerTick) <= sqrtPriceX96);
        assert.ok(tickToSqrtPriceX96(upperTick) >= sqrtPriceX96);
      }
    }
  });

  it("keeps a clamped opening price inside the derived bounds", function () {
    const clampedWad = clampDisplayPriceWad(parseDisplayPriceWad("0.0001", "test price"));
    for (const orientation of [USDC_OUTCOME_IS_CURRENCY0, USDC_COLLATERAL_IS_CURRENCY0]) {
      const { lowerTick, upperTick } = deriveEpsilonBoundTicks(orientation);
      const tick = displayPriceWadToTick({
        ...orientation,
        displayPriceWad: clampedWad,
        rounding: "down",
      });
      assert.ok(tick >= lowerTick && tick <= upperTick);
    }
  });
});

describe("alignTickToSpacing", function () {
  it("floors down and ceils up across zero without truncation artifacts", function () {
    assert.equal(alignTickToSpacing(-283256, 60, "down"), -283260);
    assert.equal(alignTickToSpacing(-283256, 60, "up"), -283200);
    assert.equal(alignTickToSpacing(61, 60, "down"), 60);
    assert.equal(alignTickToSpacing(61, 60, "up"), 120);
    assert.equal(alignTickToSpacing(-10, 60, "up"), 0);
    assert.equal(alignTickToSpacing(-283260, 60, "down"), -283260);
    assert.equal(alignTickToSpacing(-283260, 60, "up"), -283260);
  });

  it("rejects non-integer ticks and non-positive spacings", function () {
    assert.throws(() => alignTickToSpacing(0.5, 60, "down"), /integer/);
    assert.throws(() => alignTickToSpacing(60, 0, "down"), /positive integer/);
  });
});

describe("clampDisplayPriceWad", function () {
  it("clamps to the ADR 0009 epsilon band and keeps in-band prices", function () {
    assert.equal(clampDisplayPriceWad(0n), COMPLETE_SET_PRICE_POLICY.minDisplayPriceWad);
    assert.equal(
      clampDisplayPriceWad(COMPLETE_SET_PRICE_POLICY.minDisplayPriceWad - 1n),
      COMPLETE_SET_PRICE_POLICY.minDisplayPriceWad,
    );
    assert.equal(
      clampDisplayPriceWad(COMPLETE_SET_PRICE_POLICY.minDisplayPriceWad),
      COMPLETE_SET_PRICE_POLICY.minDisplayPriceWad,
    );
    assert.equal(clampDisplayPriceWad(HALF_WAD), HALF_WAD);
    assert.equal(
      clampDisplayPriceWad(COMPLETE_SET_PRICE_POLICY.maxDisplayPriceWad),
      COMPLETE_SET_PRICE_POLICY.maxDisplayPriceWad,
    );
    assert.equal(
      clampDisplayPriceWad(COMPLETE_SET_PRICE_POLICY.maxDisplayPriceWad + 1n),
      COMPLETE_SET_PRICE_POLICY.maxDisplayPriceWad,
    );
    assert.equal(clampDisplayPriceWad(2n * WAD), COMPLETE_SET_PRICE_POLICY.maxDisplayPriceWad);
  });
});

describe("parseDisplayPriceWad", function () {
  it("parses decimal strings exactly into WAD", function () {
    assert.equal(parseDisplayPriceWad("0.5", "price"), HALF_WAD);
    assert.equal(parseDisplayPriceWad("0.001", "price"), 1_000_000_000_000_000n);
    assert.equal(parseDisplayPriceWad("1", "price"), WAD);
    assert.equal(parseDisplayPriceWad("0.000000000000000001", "price"), 1n);
  });

  it("rejects malformed, zero, negative, and over-precise input", function () {
    assert.throws(() => parseDisplayPriceWad("half", "price"), /positive decimal number/);
    assert.throws(() => parseDisplayPriceWad("-0.5", "price"), /positive decimal number/);
    assert.throws(() => parseDisplayPriceWad("0", "price"), /greater than zero/);
    assert.throws(() => parseDisplayPriceWad("0.0", "price"), /greater than zero/);
    assert.throws(
      () => parseDisplayPriceWad("0.0000000000000000001", "price"),
      /at most 18 decimal places/,
    );
  });
});
