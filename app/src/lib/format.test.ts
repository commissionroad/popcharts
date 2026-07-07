import { describe, expect, it } from "vitest";

import {
  formatAddress,
  formatB,
  formatCents,
  formatDateTime,
  formatPercent,
  formatTokenAmount,
  formatUsd,
  formatUsdCompact,
  formatUsdWhole,
} from "./format";

const WAD = 10n ** 18n;

describe("formatAddress", () => {
  it("shortens long addresses to head and tail", () => {
    expect(formatAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(
      "0xd8d...045"
    );
  });

  it("passes values of ten characters or fewer through unchanged", () => {
    expect(formatAddress("0x12345678")).toBe("0x12345678");
    expect(formatAddress("0x12345678aa".slice(0, 10))).toBe("0x12345678");
    expect(formatAddress("")).toBe("");
  });

  it("shortens from eleven characters up", () => {
    expect(formatAddress("0x123456789")).toBe("0x123...789");
  });
});

describe("date formatting", () => {
  it("formats ISO timestamps in UTC regardless of environment timezone", () => {
    expect(formatDateTime("2026-08-01T00:00:00.000Z")).toBe(
      "Aug 1, 2026, 12:00 AM UTC"
    );
  });

  it("passes unparseable values through unchanged", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});

describe("money formatting", () => {
  it("formats compact USD values without environment-dependent fractions", () => {
    expect(formatUsdCompact(0)).toBe("$0");
    expect(formatUsdCompact(999)).toBe("$999");
    expect(formatUsdCompact(1_000)).toBe("$1K");
    expect(formatUsdCompact(1_500_000)).toBe("$1.5M");
  });

  it("drops the decimal from ten compact units up", () => {
    expect(formatUsdCompact(12_300_000)).toBe("$12M");
    expect(formatUsdCompact(2_000_000_000)).toBe("$2B");
  });

  it("clamps negative compact values to $0", () => {
    expect(formatUsdCompact(-1_500)).toBe("$0");
  });

  it("formats whole USD values deterministically", () => {
    expect(formatUsdWhole(0)).toBe("$0");
    expect(formatUsdWhole(12_345.67)).toBe("$12,346");
  });

  it("clamps negative whole USD values to $0", () => {
    expect(formatUsdWhole(-500)).toBe("$0");
  });

  it("shows cents only below $100", () => {
    expect(formatUsd(42.5)).toBe("$42.50");
    expect(formatUsd(99.999)).toBe("$100.00");
    expect(formatUsd(100)).toBe("$100");
    expect(formatUsd(1_234.56)).toBe("$1,235");
  });

  it("clamps negative USD values to $0.00", () => {
    expect(formatUsd(-42.5)).toBe("$0.00");
  });
});

describe("market number formatting", () => {
  it("rounds prices to whole cents", () => {
    expect(formatCents(63.7)).toBe("64c");
    expect(formatCents(0.4)).toBe("0c");
    expect(formatCents(0)).toBe("0c");
  });

  it("rounds probabilities to whole percentages", () => {
    expect(formatPercent(49.5)).toBe("50%");
    expect(formatPercent(0.4)).toBe("0%");
    expect(formatPercent(100)).toBe("100%");
  });

  it("formats the liquidity parameter with separators and no currency", () => {
    expect(formatB(5_000)).toBe("5,000");
    expect(formatB(123.45)).toBe("123.45");
  });
});

describe("formatTokenAmount", () => {
  it("shows whole tokens without decimals at 100 and above", () => {
    expect(formatTokenAmount(100n * WAD)).toBe("100");
    expect(formatTokenAmount(12_500n * WAD)).toBe("12,500");
    expect(formatTokenAmount(150n * WAD + WAD / 2n)).toBe("151");
  });

  it("shows two decimals for positive amounts below 100", () => {
    expect(formatTokenAmount(WAD / 2n)).toBe("0.50");
    expect(formatTokenAmount(42n * WAD + WAD / 2n)).toBe("42.50");
    expect(formatTokenAmount(99n * WAD)).toBe("99.00");
  });

  it("shows zero without decimals", () => {
    expect(formatTokenAmount(0n)).toBe("0");
  });

  it("rounds dust below a cent to 0.00", () => {
    expect(formatTokenAmount(1n)).toBe("0.00");
  });
});
