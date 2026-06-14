import { describe, expect, it } from "vitest";

import { formatUsdCompact, formatUsdWhole } from "./format";

describe("money formatting", () => {
  it("formats compact USD values without environment-dependent fractions", () => {
    expect(formatUsdCompact(0)).toBe("$0");
    expect(formatUsdCompact(999)).toBe("$999");
    expect(formatUsdCompact(1_000)).toBe("$1K");
    expect(formatUsdCompact(1_500_000)).toBe("$1.5M");
  });

  it("formats whole USD values deterministically", () => {
    expect(formatUsdWhole(0)).toBe("$0");
    expect(formatUsdWhole(12_345.67)).toBe("$12,346");
  });
});
