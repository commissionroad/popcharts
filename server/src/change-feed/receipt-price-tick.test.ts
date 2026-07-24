import { currentYesPriceCents } from "@popcharts/protocol/virtual-lmsr";
import { describe, expect, it } from "bun:test";

import { buildPriceTick } from "src/change-feed/receipt-price-tick";

const WAD = 10n ** 18n;
/** WAD-encode a plain number for building fixture market state. */
function wad(value: number): bigint {
  return BigInt(Math.round(value * 1e18));
}

describe("buildPriceTick", () => {
  const openMarket = {
    t: new Date("2026-07-24T00:00:00.000Z"),
    sequence: 1n,
    liquidityParameterWad: wad(5_000),
    openingProbabilityWad: wad(0.5),
    yesSharesWad: 0n,
    noSharesWad: 0n,
  };

  it("prices a just-opened market at its opening probability", () => {
    const tick = buildPriceTick(openMarket);

    expect(tick.yesPriceCents).toBeCloseTo(50, 6);
    expect(tick.noPriceCents).toBeCloseTo(50, 6);
  });

  it("carries the trade time as an ISO string and the sequence as a number", () => {
    const tick = buildPriceTick({ ...openMarket, sequence: 42n });

    expect(tick.t).toBe("2026-07-24T00:00:00.000Z");
    expect(tick.sequence).toBe(42);
  });

  it("keeps YES and NO complementary", () => {
    const tick = buildPriceTick({
      ...openMarket,
      yesSharesWad: wad(500),
      noSharesWad: wad(120),
    });

    expect(tick.yesPriceCents + tick.noPriceCents).toBe(100);
  });

  it("matches the shared LMSR on the same WAD-decoded state — the pushed price cannot drift from a refetched one", () => {
    const state = {
      liquidityParameterWad: wad(5_000),
      openingProbabilityWad: wad(0.5),
      yesSharesWad: wad(500),
      noSharesWad: wad(120),
    };

    const tick = buildPriceTick({ t: new Date(), sequence: 3n, ...state });

    // The app derives its price by wad-decoding the same columns and calling
    // the same function; reproduce that decode here and require exact equality.
    const expected = currentYesPriceCents({
      b: Number(state.liquidityParameterWad) / 1e18,
      openingProbability: Number(
        (state.openingProbabilityWad * 100n + WAD / 2n) / WAD,
      ),
      yesShares: Number(state.yesSharesWad) / 1e18,
      noShares: Number(state.noSharesWad) / 1e18,
    });

    expect(tick.yesPriceCents).toBe(expected);
  });
});
