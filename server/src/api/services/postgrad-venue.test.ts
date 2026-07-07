import { describe, expect, it } from "bun:test";

import {
  buildOutcomePoolKey,
  closingYesDisplayPriceWad,
  computePoolId,
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
