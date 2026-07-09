import { describe, expect, it } from "bun:test";

import type { schema } from "src/db/client";

import type { ChainGraduationResult } from "./dev-market-graduate";
import {
  buildGraduationSummary,
  evaluateGraduationReadiness,
  requestMarketGraduation,
  serializeGraduationSummary,
} from "./graduation";

const WAD = 10n ** 18n;

type MarketRow = typeof schema.markets.$inferSelect;

function createMarketRow(overrides: Partial<MarketRow> = {}): MarketRow {
  return {
    bypassAiResolution: false,
    chainId: 31337,
    collateral: "0x0000000000000000000000000000000000000001",
    contractId: 1,
    createdAt: new Date("2026-06-22T15:00:00.000Z"),
    createdBlockNumber: 10n,
    createdBlockTimestamp: new Date("2026-06-22T15:00:00.000Z"),
    createdLogIndex: 2,
    createdTransactionHash:
      "0xccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    creator: "0x0000000000000000000000000000000000000002",
    graduationThreshold: 40_000n * WAD,
    graduationTime: new Date("2026-06-23T15:00:00.000Z"),
    id: 12,
    liquidityParameter: 5_000n * WAD,
    marketId: 7n,
    metadataHash:
      "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    noShares: 50_000n * WAD,
    openingProbabilityWad: WAD / 2n,
    receiptCount: 2n,
    resolutionTime: new Date("2026-07-22T15:00:00.000Z"),
    status: "bootstrap",
    totalEscrowed: 125_000n * WAD,
    updatedAt: new Date("2026-06-22T15:00:00.000Z"),
    yesNotBefore: null,
    yesShares: 50_000n * WAD,
    ...overrides,
  };
}

const GRADUATED_OUTCOME: ChainGraduationResult = {
  finalized: {
    blockTimestamp: new Date("2026-06-22T16:00:00.000Z"),
    completeSetCount: 50_000n * WAD,
    matchedMarketCap: 50_000n * WAD,
    refundTotal: 0n,
    retainedCostTotal: 50_000n * WAD,
  },
  kind: "graduated",
  transactionHashes: ["0x01"],
};

describe("requestMarketGraduation (failsafe)", () => {
  it("runs the on-chain settlement for an eligible market", async () => {
    const calls: Array<{ force: boolean; marketId: bigint }> = [];
    const row = { market: createMarketRow(), metadata: null };

    const result = await requestMarketGraduation(
      { chainId: 31337, marketId: "7" },
      {
        selectMarket: async () =>
          calls.length === 0
            ? row
            : {
                market: createMarketRow({ status: "graduated" }),
                metadata: null,
              },
        settleGraduationOnChain: async (marketId, force) => {
          calls.push({ force, marketId });
          return GRADUATED_OUTCOME;
        },
      },
    );

    expect(result.kind).toBe("graduated");
    // The failsafe never forces liquidity.
    expect(calls).toEqual([{ force: false, marketId: 7n }]);
  });

  it("reports below-threshold markets without touching the chain", async () => {
    let settled = false;
    const row = {
      market: createMarketRow({
        noShares: 10_000n * WAD,
        yesShares: 10_000n * WAD,
      }),
      metadata: null,
    };

    const result = await requestMarketGraduation(
      { chainId: 31337, marketId: "7" },
      {
        selectMarket: async () => row,
        settleGraduationOnChain: async () => {
          settled = true;
          return GRADUATED_OUTCOME;
        },
      },
    );

    expect(result).toMatchObject({
      kind: "ineligible",
      reason: "below_threshold",
    });
    expect(settled).toBe(false);
  });

  it("surfaces a below-threshold band-pass result the display cap missed", async () => {
    // Display cap (min of totals) clears the threshold, but the real sweep does
    // not — the settlement reports below_threshold and nothing graduates.
    const row = { market: createMarketRow(), metadata: null };

    const result = await requestMarketGraduation(
      { chainId: 31337, marketId: "7" },
      {
        selectMarket: async () => row,
        settleGraduationOnChain: async () => ({
          kind: "below_threshold",
          matchedMarketCap: 5_000n * WAD,
          threshold: 40_000n * WAD,
        }),
      },
    );

    expect(result).toMatchObject({
      kind: "ineligible",
      reason: "below_threshold",
    });
    if (result.kind === "ineligible") {
      expect(result.summary.matchedMarketCap).toBe((5_000n * WAD).toString());
    }
  });

  it("returns not_found when the market is missing", async () => {
    const result = await requestMarketGraduation(
      { chainId: 31337, marketId: "7" },
      {
        selectMarket: async () => null,
        settleGraduationOnChain: async () => GRADUATED_OUTCOME,
      },
    );

    expect(result.kind).toBe("not_found");
  });
});

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

describe("evaluateGraduationReadiness", () => {
  it("requires onchain settlement even when bootstrap liquidity reaches threshold", () => {
    expect(
      evaluateGraduationReadiness({
        graduationThreshold: wad(40_000),
        matchedMarketCap: wad(40_000),
        status: "bootstrap",
      }),
    ).toMatchObject({
      kind: "ineligible",
      reason: "onchain_settlement_required",
    });
  });

  it("reports pending clearing while the indexed market is graduating", () => {
    expect(
      evaluateGraduationReadiness({
        graduationThreshold: wad(40_000),
        matchedMarketCap: wad(45_000),
        status: "graduating",
      }),
    ).toMatchObject({
      kind: "ineligible",
      reason: "clearing_pending",
    });
  });

  it("returns already graduated only after indexed finalization", () => {
    expect(
      evaluateGraduationReadiness({
        graduationThreshold: wad(40_000),
        matchedMarketCap: wad(45_000),
        status: "graduated",
      }),
    ).toEqual({ kind: "already_graduated" });
  });
});

function wad(value: number) {
  return BigInt(value) * WAD;
}
