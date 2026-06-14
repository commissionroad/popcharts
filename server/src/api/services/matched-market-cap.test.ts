import { describe, expect, it } from "bun:test";

import { calculateMatchedMarketCap } from "./matched-market-cap";

const WAD = 10n ** 18n;

describe("calculateMatchedMarketCap", () => {
  it("returns zero for one-sided receipt books", () => {
    expect(
      calculateMatchedMarketCap({
        noShares: 0n,
        yesShares: wad(125),
      }),
    ).toBe(0n);
  });

  it("matches the smaller path side instead of the smaller collateral side", () => {
    expect(
      calculateMatchedMarketCap({
        noShares: wad(590),
        yesShares: wad(1833),
      }),
    ).toBe(590n * WAD);
  });

  it("uses the scarce side regardless of direction", () => {
    expect(
      calculateMatchedMarketCap({
        noShares: wad(2500),
        yesShares: wad(1200),
      }),
    ).toBe(1200n * WAD);
  });
});

function wad(value: number) {
  return BigInt(value) * WAD;
}
