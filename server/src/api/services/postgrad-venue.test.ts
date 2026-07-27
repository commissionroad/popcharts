import { describe, expect, it } from "bun:test";

import { displayPriceWadToSqrtPriceX96 } from "@popcharts/protocol";

// Pool-key and pool-id derivation belongs to @popcharts/protocol, so its
// tests live beside it in protocol/test/nodejs/outcome-pool-key.test.ts.
import {
  closingYesDisplayPriceWad,
  serializeOutcomePool,
} from "./postgrad-venue";

const WAD = 10n ** 18n;
const HIGH_TOKEN = "0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF" as const;

/** Asserts a WAD decimal string is within 1000 wei of the expected price. */
function expectWithinWad(actual: string | undefined, expected: bigint) {
  expect(actual).toBeDefined();
  const price = BigInt(actual ?? "0");
  const delta = price > expected ? price - expected : expected - price;
  expect(delta <= 1_000n).toBe(true);
}

describe("serializeOutcomePool", () => {
  const pool = {
    outcomeToken: HIGH_TOKEN,
    poolId: `0x${"11".repeat(32)}` as const,
    whitelisted: true,
  };

  it("recovers the display price a pool was initialized at", () => {
    const orientation = {
      collateralDecimals: 18,
      outcomeDecimals: 18,
      outcomeIsCurrency0: true,
    };
    const serialized = serializeOutcomePool({
      ...pool,
      collateralDecimals: orientation.collateralDecimals,
      outcomeIsCurrency0: orientation.outcomeIsCurrency0,
      sqrtPriceX96: displayPriceWadToSqrtPriceX96({
        ...orientation,
        displayPriceWad: 620_000_000_000_000_000n,
      }),
    });

    expect(serialized.initialized).toBe(true);
    expect(serialized.whitelisted).toBe(true);
    expect(serialized.outcomeTokenAddress).toBe(HIGH_TOKEN.toLowerCase());
    // The sqrt conversions truncate, so allow a sub-thousand-wei round trip.
    expectWithinWad(serialized.displayPriceWad, 620_000_000_000_000_000n);
  });

  it("handles the inverted orientation and mixed token decimals", () => {
    const orientation = {
      collateralDecimals: 6,
      outcomeDecimals: 18,
      outcomeIsCurrency0: false,
    };
    const serialized = serializeOutcomePool({
      ...pool,
      collateralDecimals: orientation.collateralDecimals,
      outcomeIsCurrency0: orientation.outcomeIsCurrency0,
      sqrtPriceX96: displayPriceWadToSqrtPriceX96({
        ...orientation,
        displayPriceWad: 380_000_000_000_000_000n,
      }),
    });

    expectWithinWad(serialized.displayPriceWad, 380_000_000_000_000_000n);
  });

  it("omits the display price for an uninitialized pool", () => {
    const serialized = serializeOutcomePool({
      ...pool,
      collateralDecimals: 18,
      outcomeIsCurrency0: true,
      sqrtPriceX96: 0n,
      whitelisted: false,
    });

    expect(serialized).toEqual({
      initialized: false,
      outcomeTokenAddress: HIGH_TOKEN.toLowerCase(),
      poolId: pool.poolId,
      whitelisted: false,
    });
    expect(serialized.displayPriceWad).toBeUndefined();
  });
});

describe("closingYesDisplayPriceWad", () => {
  it("keeps the opening probability when no shares traded", () => {
    const price = closingYesDisplayPriceWad({
      liquidityParameter: 5_000n * WAD,
      noShares: 0n,
      openingProbabilityWad: WAD / 2n,
      yesShares: 0n,
    });

    expect(price).toBe(WAD / 2n);
  });

  it("moves above one half when YES demand dominates", () => {
    const price = closingYesDisplayPriceWad({
      liquidityParameter: 5_000n * WAD,
      noShares: 1_000n * WAD,
      openingProbabilityWad: WAD / 2n,
      yesShares: 4_000n * WAD,
    });

    expect(price > WAD / 2n).toBe(true);
    expect(price < WAD).toBe(true);
  });

  it("clamps extreme books into the display-price epsilon band", () => {
    const price = closingYesDisplayPriceWad({
      liquidityParameter: 500n * WAD,
      noShares: 0n,
      openingProbabilityWad: WAD / 2n,
      yesShares: 100_000n * WAD,
    });

    expect(price).toBe(999_000_000_000_000_000n);
  });

  it("falls back to the clamped opening probability without liquidity", () => {
    const price = closingYesDisplayPriceWad({
      liquidityParameter: 0n,
      noShares: 0n,
      openingProbabilityWad: WAD,
      yesShares: 0n,
    });

    expect(price).toBe(999_000_000_000_000_000n);
  });
});
