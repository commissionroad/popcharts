import { describe, expect, it } from "vitest";

import { formatLadderShares } from "./order-book-format";

describe("formatLadderShares", () => {
  it("shows whole shares with separators at 100 and above", () => {
    expect(formatLadderShares(1250)).toBe("1,250");
    expect(formatLadderShares(100)).toBe("100");
  });

  it("keeps two decimals below 100 where they matter", () => {
    expect(formatLadderShares(42.5)).toBe("42.50");
    expect(formatLadderShares(0.25)).toBe("0.25");
  });

  it("formats zero without decimals", () => {
    expect(formatLadderShares(0)).toBe("0");
  });
});
