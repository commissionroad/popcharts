import { describe, expect, it } from "bun:test";

import { displayPriceWadToSqrtPriceX96 } from "@popcharts/protocol";

import {
  buildOutcomePoolKey,
  closingYesDisplayPriceWad,
  computePoolId,
  serializeOutcomePool,
} from "./postgrad-venue";

const WAD = 10n ** 18n;
const COLLATERAL = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
const LOW_TOKEN = "0x0000000000000000000000000000000000000abc" as const;
const HIGH_TOKEN = "0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF" as const;

describe("buildOutcomePoolKey", () => {
  it("sorts the outcome token below collateral when its address is lower", () => {
    const { key, outcomeIsCurrency0 } = buildOutcomePoolKey({
      collateral: COLLATERAL,
      outcomeToken: LOW_TOKEN,
    });

    expect(outcomeIsCurrency0).toBe(true);
    expect(key.currency0).toBe(LOW_TOKEN);
    expect(key.currency1).toBe(COLLATERAL);
    expect(key.fee).toBe(3000);
    expect(key.tickSpacing).toBe(60);
  });

  it("sorts collateral first when the outcome token address is higher", () => {
    const { key, outcomeIsCurrency0 } = buildOutcomePoolKey({
      collateral: COLLATERAL,
      outcomeToken: HIGH_TOKEN,
    });

    expect(outcomeIsCurrency0).toBe(false);
    expect(key.currency0).toBe(COLLATERAL);
    expect(key.currency1).toBe(HIGH_TOKEN);
  });
});

describe("computePoolId", () => {
  it("is deterministic and sensitive to every key field", () => {
    const { key } = buildOutcomePoolKey({
      collateral: COLLATERAL,
      outcomeToken: LOW_TOKEN,
    });

    expect(computePoolId(key)).toBe(computePoolId({ ...key }));
    expect(computePoolId(key)).not.toBe(
      computePoolId({ ...key, tickSpacing: 10 }),
    );
    expect(computePoolId(key)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

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
