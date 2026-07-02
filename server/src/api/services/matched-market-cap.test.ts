import { describe, expect, it } from "bun:test";

import { calculateMatchedMarketCap } from "./matched-market-cap";

const WAD = 10n ** 18n;

describe("calculateMatchedMarketCap", () => {
  it("returns zero for one-sided receipt books", () => {
    expect(
      calculateMatchedMarketCap([
        { rHigh: wad(125).toString(), rLow: "0", side: 0 },
      ]),
    ).toBe(0n);
  });

  it("counts overlapping YES and NO path intervals", () => {
    expect(
      calculateMatchedMarketCap([
        { rHigh: wad(100).toString(), rLow: "0", side: 0 },
        { rHigh: wad(80).toString(), rLow: wad(20).toString(), side: 1 },
      ]),
    ).toBe(wad(60));
  });

  it("does not match opposite-side receipts that occupy different path bands", () => {
    expect(
      calculateMatchedMarketCap([
        { rHigh: wad(100).toString(), rLow: "0", side: 0 },
        { rHigh: "0", rLow: `-${wad(50).toString()}`, side: 1 },
      ]),
    ).toBe(0n);
  });

  it("weights repeated coverage within the same path segment", () => {
    expect(
      calculateMatchedMarketCap([
        { rHigh: wad(100).toString(), rLow: "0", side: 0 },
        { rHigh: wad(100).toString(), rLow: "0", side: 0 },
        { rHigh: wad(75).toString(), rLow: wad(25).toString(), side: 1 },
        { rHigh: wad(75).toString(), rLow: wad(25).toString(), side: 1 },
      ]),
    ).toBe(wad(100));
  });

  it("normalizes reversed intervals and ignores invalid bands", () => {
    expect(
      calculateMatchedMarketCap([
        { rHigh: "0", rLow: wad(25).toString(), side: 0 },
        { rHigh: wad(20).toString(), rLow: wad(5).toString(), side: 1 },
        { rHigh: wad(10).toString(), rLow: wad(10).toString(), side: 1 },
        { rHigh: wad(10).toString(), rLow: "0", side: 9 },
      ]),
    ).toBe(wad(15));
  });
});

function wad(value: number) {
  return BigInt(value) * WAD;
}
