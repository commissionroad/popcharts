import { describe, expect, it } from "bun:test";

import {
  buildGraduationSummary,
  serializeGraduationSummary,
} from "./graduation";

const WAD = 10n ** 18n;

describe("graduation summaries", () => {
  it("mints one YES and one NO token per matched complete set", () => {
    const graduatedAt = new Date("2026-06-14T12:00:00.000Z");
    const summary = buildGraduationSummary({
      graduatedAt,
      graduationThreshold: wad(40_000),
      matchedMarketCap: wad(50_000),
      receiptCount: 12n,
      totalEscrowed: wad(67_500),
    });

    expect(summary.completeSetCount).toBe(wad(50_000));
    expect(summary.yesTokens).toBe(wad(50_000));
    expect(summary.noTokens).toBe(wad(50_000));
    expect(summary.refundedCollateral).toBe(wad(17_500));
    expect(summary.graduatedAt).toBe(graduatedAt);
  });

  it("never reports negative refunds if matched cap exceeds current escrow", () => {
    const summary = buildGraduationSummary({
      graduationThreshold: wad(10),
      matchedMarketCap: wad(12),
      receiptCount: 2n,
      totalEscrowed: wad(10),
    });

    expect(summary.refundedCollateral).toBe(0n);
  });

  it("serializes bigints for API responses", () => {
    const summary = serializeGraduationSummary(
      buildGraduationSummary({
        graduatedAt: new Date("2026-06-14T12:00:00.000Z"),
        graduationThreshold: wad(40_000),
        matchedMarketCap: wad(50_000),
        receiptCount: 12n,
        totalEscrowed: wad(67_500),
      }),
    );

    expect(summary).toMatchObject({
      completeSetCount: wad(50_000).toString(),
      graduatedAt: "2026-06-14T12:00:00.000Z",
      noTokens: wad(50_000).toString(),
      receiptCount: "12",
      refundedCollateral: wad(17_500).toString(),
      yesTokens: wad(50_000).toString(),
    });
  });
});

function wad(value: number) {
  return BigInt(value) * WAD;
}
