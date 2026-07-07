import { describe, expect, it } from "vitest";

import { TOKEN_DECIMALS, WAD, wadToNumber } from "./wad";

describe("WAD constants", () => {
  it("keeps WAD and TOKEN_DECIMALS consistent", () => {
    expect(WAD).toBe(10n ** BigInt(TOKEN_DECIMALS));
    expect(TOKEN_DECIMALS).toBe(18);
  });
});

describe("wadToNumber", () => {
  it("converts zero", () => {
    expect(wadToNumber(0n)).toBe(0);
  });

  it("converts whole WAD multiples exactly", () => {
    expect(wadToNumber(WAD)).toBe(1);
    expect(wadToNumber(5_000n * WAD)).toBe(5000);
  });

  it("keeps the fractional part", () => {
    expect(wadToNumber(WAD / 2n)).toBe(0.5);
    expect(wadToNumber(WAD + WAD / 4n)).toBe(1.25);
  });

  it("converts values smaller than one wei of a token", () => {
    expect(wadToNumber(1n)).toBe(1e-18);
  });

  it("handles negative values", () => {
    expect(wadToNumber(-WAD)).toBe(-1);
    expect(wadToNumber(-(WAD + WAD / 2n))).toBe(-1.5);
  });

  it("converts values beyond the float-exact integer range approximately", () => {
    expect(wadToNumber(1_000_000_000n * WAD)).toBe(1_000_000_000);
  });
});
