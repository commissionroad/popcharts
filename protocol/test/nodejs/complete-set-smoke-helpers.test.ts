import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDecimalTokenAmount } from "../../scripts/shared/cli/parseDecimalTokenAmount.js";
import { decideCompleteSetArbAction } from "../../src/market/decideCompleteSetArbAction.js";
import { floorOutcomeToCollateralUnit } from "../../src/market/floorOutcomeToCollateralUnit.js";
import { displayPriceWadToSqrtPriceX96 } from "../../src/price/displayPriceWadToSqrtPriceX96.js";
import { liquidityForAmounts } from "../../src/price/liquidityForAmounts.js";
import { sqrtPriceX96ToDisplayPriceWad } from "../../src/price/sqrtPriceX96ToDisplayPriceWad.js";
import { tickToSqrtPriceX96 } from "../../src/price/tickToSqrtPriceX96.js";

const WAD = 10n ** 18n;
const Q96 = 1n << 96n;

// The two collateral setups ADR 0009 cares about, in both currency sort
// orders, always against 18-decimal outcome tokens.
const ORIENTATIONS = [
  { collateralDecimals: 6, outcomeDecimals: 18, outcomeIsCurrency0: true },
  { collateralDecimals: 6, outcomeDecimals: 18, outcomeIsCurrency0: false },
  { collateralDecimals: 18, outcomeDecimals: 18, outcomeIsCurrency0: true },
  { collateralDecimals: 18, outcomeDecimals: 18, outcomeIsCurrency0: false },
] as const;

describe("decideCompleteSetArbAction", function () {
  it("mints and sells when the price sum exceeds one full set", function () {
    const decision = decideCompleteSetArbAction({
      noDisplayPriceWad: WAD / 2n,
      toleranceWad: 0n,
      yesDisplayPriceWad: WAD / 2n + 10n ** 15n,
    });
    assert.equal(decision.action, "mintAndSell");
    assert.equal(decision.priceSumWad, WAD + 10n ** 15n);
  });

  it("buys and merges when the price sum falls below one full set", function () {
    const decision = decideCompleteSetArbAction({
      noDisplayPriceWad: WAD / 2n - 10n ** 15n,
      toleranceWad: 0n,
      yesDisplayPriceWad: WAD / 2n,
    });
    assert.equal(decision.action, "buyAndMerge");
  });

  it("holds inside the tolerance band", function () {
    const decision = decideCompleteSetArbAction({
      noDisplayPriceWad: WAD / 2n + 10n ** 15n,
      toleranceWad: 10n ** 16n,
      yesDisplayPriceWad: WAD / 2n,
    });
    assert.equal(decision.action, "hold");
  });

  it("rejects non-positive prices and negative tolerances", function () {
    assert.throws(
      () =>
        decideCompleteSetArbAction({
          noDisplayPriceWad: 0n,
          toleranceWad: 0n,
          yesDisplayPriceWad: WAD / 2n,
        }),
      /positive display prices/,
    );
    assert.throws(
      () =>
        decideCompleteSetArbAction({
          noDisplayPriceWad: WAD / 2n,
          toleranceWad: -1n,
          yesDisplayPriceWad: WAD / 2n,
        }),
      /non-negative tolerance/,
    );
  });
});

describe("sqrtPriceX96ToDisplayPriceWad", function () {
  it("round-trips displayPriceWadToSqrtPriceX96 for every ADR 0009 orientation", function () {
    for (const orientation of ORIENTATIONS) {
      for (const displayPriceWad of [WAD / 1000n, WAD / 2n, (WAD * 999n) / 1000n]) {
        const sqrtPriceX96 = displayPriceWadToSqrtPriceX96({ ...orientation, displayPriceWad });
        const roundTripped = sqrtPriceX96ToDisplayPriceWad({ ...orientation, sqrtPriceX96 });
        const difference =
          roundTripped > displayPriceWad
            ? roundTripped - displayPriceWad
            : displayPriceWad - roundTripped;
        // The sqrt conversion floors once in each direction; the residual is
        // far below any price the smoke flows compare.
        assert.ok(
          difference * 10n ** 9n <= displayPriceWad,
          `round trip drifted by ${difference} for ${JSON.stringify(orientation)}`,
        );
      }
    }
  });

  it("rejects non-positive sqrt prices", function () {
    assert.throws(
      () =>
        sqrtPriceX96ToDisplayPriceWad({
          collateralDecimals: 18,
          outcomeDecimals: 18,
          outcomeIsCurrency0: true,
          sqrtPriceX96: 0n,
        }),
      /positive/,
    );
  });
});

describe("parseDecimalTokenAmount", function () {
  it("parses exact raw amounts for the token's decimals", function () {
    assert.equal(parseDecimalTokenAmount("2.5", { decimals: 6, label: "AMOUNT" }), 2_500_000n);
    assert.equal(parseDecimalTokenAmount("25", { decimals: 18, label: "AMOUNT" }), 25n * WAD);
    assert.equal(
      parseDecimalTokenAmount("0", { allowZero: true, decimals: 6, label: "AMOUNT" }),
      0n,
    );
  });

  it("rejects malformed, over-precise, and zero amounts", function () {
    assert.throws(() => parseDecimalTokenAmount("-1", { decimals: 6, label: "AMOUNT" }), /AMOUNT/);
    assert.throws(
      () => parseDecimalTokenAmount("1.0000001", { decimals: 6, label: "AMOUNT" }),
      /at most 6 decimal places/,
    );
    assert.throws(
      () => parseDecimalTokenAmount("0", { decimals: 6, label: "AMOUNT" }),
      /greater than zero/,
    );
    assert.throws(
      () => parseDecimalTokenAmount("1", { decimals: -1, label: "AMOUNT" }),
      /decimals/,
    );
  });
});

describe("floorOutcomeToCollateralUnit", function () {
  it("floors outcome amounts to exact collateral conversions", function () {
    assert.equal(
      floorOutcomeToCollateralUnit({
        collateralDecimals: 6,
        outcomeAmount: 1_000_000_000_001n,
        outcomeDecimals: 18,
      }),
      1_000_000_000_000n,
    );
    assert.equal(
      floorOutcomeToCollateralUnit({
        collateralDecimals: 18,
        outcomeAmount: 123n,
        outcomeDecimals: 18,
      }),
      123n,
    );
  });

  it("rejects invalid decimals and negative amounts", function () {
    assert.throws(
      () =>
        floorOutcomeToCollateralUnit({
          collateralDecimals: 6,
          outcomeAmount: -1n,
          outcomeDecimals: 18,
        }),
      /non-negative/,
    );
    assert.throws(
      () =>
        floorOutcomeToCollateralUnit({
          collateralDecimals: -1,
          outcomeAmount: 1n,
          outcomeDecimals: 18,
        }),
      /collateralDecimals/,
    );
  });
});

describe("liquidityForAmounts", function () {
  it("sizes liquidity that stays within both token budgets", function () {
    const sqrtPriceX96 = tickToSqrtPriceX96(0);
    const sqrtPriceLowerX96 = tickToSqrtPriceX96(-1500);
    const sqrtPriceUpperX96 = tickToSqrtPriceX96(1500);
    const amount0Max = 100n * WAD;
    const amount1Max = 100n * WAD;
    const liquidity = liquidityForAmounts({
      amount0Max,
      amount1Max,
      sqrtPriceLowerX96,
      sqrtPriceUpperX96,
      sqrtPriceX96,
    });
    assert.ok(liquidity > 0n);

    // Invert the v4 amount formulas: the position must not need more than
    // either budget at the current price.
    const needed0 =
      (liquidity * Q96 * (sqrtPriceUpperX96 - sqrtPriceX96)) / (sqrtPriceX96 * sqrtPriceUpperX96);
    const needed1 = (liquidity * (sqrtPriceX96 - sqrtPriceLowerX96)) / Q96;
    assert.ok(needed0 <= amount0Max, `needed0 ${needed0} exceeds budget`);
    assert.ok(needed1 <= amount1Max, `needed1 ${needed1} exceeds budget`);
  });

  it("uses the single-sided formula outside the range and rejects bad ranges", function () {
    const below = liquidityForAmounts({
      amount0Max: WAD,
      amount1Max: 0n,
      sqrtPriceLowerX96: tickToSqrtPriceX96(60),
      sqrtPriceUpperX96: tickToSqrtPriceX96(120),
      sqrtPriceX96: tickToSqrtPriceX96(0),
    });
    assert.ok(below > 0n);

    assert.throws(
      () =>
        liquidityForAmounts({
          amount0Max: WAD,
          amount1Max: WAD,
          sqrtPriceLowerX96: tickToSqrtPriceX96(120),
          sqrtPriceUpperX96: tickToSqrtPriceX96(60),
          sqrtPriceX96: tickToSqrtPriceX96(0),
        }),
      /below/,
    );
  });
});
