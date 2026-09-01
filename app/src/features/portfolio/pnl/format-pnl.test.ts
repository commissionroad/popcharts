import { describe, expect, it } from "vitest";

import { WAD } from "@/domain/tokens/wad";

import { formatSignedPercentBps, formatSignedUsdWad } from "./format-pnl";

describe("formatSignedUsdWad", () => {
  it.each([
    { amountWad: (WAD * 2240n) / 100n, expected: "+$22.40" },
    { amountWad: (WAD * -2400n) / 100n, expected: "-$24.00" },
    { amountWad: 0n, expected: "$0.00" },
    // formatUsd drops cents at and above $100; the sign still leads.
    { amountWad: WAD * -150n, expected: "-$150" },
  ])("formats $amountWad as $expected", ({ amountWad, expected }) => {
    expect(formatSignedUsdWad(amountWad)).toBe(expected);
  });
});

describe("formatSignedPercentBps", () => {
  it.each([
    { bps: 5500, expected: "+55.0%" },
    { bps: -4363, expected: "-43.6%" },
    { bps: 0, expected: "0.0%" },
  ])("formats $bps as $expected", ({ bps, expected }) => {
    expect(formatSignedPercentBps(bps)).toBe(expected);
  });
});
