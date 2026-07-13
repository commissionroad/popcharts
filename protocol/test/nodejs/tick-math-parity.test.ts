import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";

import { COMPLETE_SET_PRICE_POLICY } from "../../scripts/shared/price/completeSetPricePolicy.js";
import { displayPriceWadToTick } from "../../scripts/shared/price/displayPriceWadToTick.js";
import {
  MAX_TICK,
  MIN_TICK,
  tickToSqrtPriceX96,
} from "../../scripts/shared/price/tickToSqrtPriceX96.js";
import { sqrtPriceX96ToTick } from "../../scripts/shared/price/sqrtPriceX96ToTick.js";

// On-chain parity anchor for the TypeScript TickMath ports (ADR 0016 C6):
// the pools run v4-core TickMath, the scripts run these ports, and this test
// fails if the two ever disagree — one mistyped hex multiplier is enough.
describe("tick math parity with v4-core TickMath", async () => {
  const { viem } = await network.create();
  const harness = await viem.deployContract("TickMathHarness");

  const boundaryTicks = [
    MIN_TICK,
    MIN_TICK + 1,
    -887200,
    -100_000,
    -50_021,
    -1,
    0,
    1,
    60,
    887,
    50_021,
    100_000,
    887200,
    MAX_TICK - 1,
    MAX_TICK,
  ];

  // Dense-ish grid across the full range; a prime step avoids hitting only
  // round-number ticks that per-bit multiplier bugs could survive.
  const gridTicks: number[] = [];
  for (let tick = MIN_TICK; tick <= MAX_TICK; tick += 60_013) {
    gridTicks.push(tick);
  }

  // Ticks the complete-set price policy actually lands on for the deployed
  // token shapes (6-decimal collateral, 18-decimal outcome, both sort orders).
  const policyTicks: number[] = [];
  for (const outcomeIsCurrency0 of [true, false]) {
    for (const displayPriceWad of [
      COMPLETE_SET_PRICE_POLICY.minDisplayPriceWad,
      COMPLETE_SET_PRICE_POLICY.maxDisplayPriceWad,
      5n * 10n ** 17n,
    ]) {
      for (const rounding of ["down", "up"] as const) {
        policyTicks.push(
          displayPriceWadToTick({
            collateralDecimals: 6,
            displayPriceWad,
            outcomeDecimals: 18,
            outcomeIsCurrency0,
            rounding,
          }),
        );
      }
    }
  }

  const ticks = [...new Set([...boundaryTicks, ...gridTicks, ...policyTicks])];

  it("matches getSqrtPriceAtTick across boundary, grid, and policy ticks", async () => {
    for (const tick of ticks) {
      const expected = await harness.read.getSqrtPriceAtTick([tick]);
      assert.equal(
        tickToSqrtPriceX96(tick),
        expected,
        `tickToSqrtPriceX96(${tick}) diverged from on-chain TickMath`,
      );
    }
  });

  it("matches getTickAtSqrtPrice at exact boundaries and between ticks", async () => {
    const maxSqrtPriceX96 = 1461446703485210103287273052203988822378723970342n;
    const sqrtSamples: bigint[] = [];
    for (const tick of ticks) {
      const exact = tickToSqrtPriceX96(tick);
      // Exact tick boundary, one below it (previous tick's territory), and a
      // point inside the tick's range — the three rounding-sensitive spots.
      sqrtSamples.push(exact);
      if (tick > MIN_TICK) {
        sqrtSamples.push(exact - 1n);
      }
      sqrtSamples.push(exact + (exact >> 20n) + 1n);
    }

    for (const sqrtPriceX96 of sqrtSamples) {
      if (sqrtPriceX96 < 4295128739n || sqrtPriceX96 >= maxSqrtPriceX96) {
        continue;
      }
      const expected = await harness.read.getTickAtSqrtPrice([sqrtPriceX96]);
      assert.equal(
        sqrtPriceX96ToTick(sqrtPriceX96),
        expected,
        `sqrtPriceX96ToTick(${sqrtPriceX96}) diverged from on-chain TickMath`,
      );
    }
  });
});
