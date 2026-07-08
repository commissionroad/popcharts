import { describe, expect, it } from "vitest";

import { formatLadderCents, formatLadderShares } from "./order-book-format";

describe("formatLadderCents", () => {
  it("formats whole-cent prices without a decimal", () => {
    expect(formatLadderCents(64)).toBe("64c");
    expect(formatLadderCents(0)).toBe("0c");
  });

  it("keeps one decimal for sub-cent tick edges", () => {
    expect(formatLadderCents(63.5)).toBe("63.5c");
    expect(formatLadderCents(12.3499)).toBe("12.3c");
  });

  it("drops a decimal that rounds back to a whole cent", () => {
    expect(formatLadderCents(63.98)).toBe("64c");
  });
});

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
