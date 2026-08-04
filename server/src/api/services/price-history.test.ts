import { describe, expect, it } from "bun:test";

import {
  COMPLETE_SET_PRICE_POLICY,
  tickToDisplayPriceWad,
} from "@popcharts/protocol";
import { currentYesPriceCents } from "@popcharts/protocol/virtual-lmsr";

import type { MarketRow } from "./markets";
import type { VenuePoolRow } from "./venue-orderbook";
import {
  downsamplePricePoints,
  getMarketPriceHistory,
  pregradPricePoints,
  type PriceHistoryDependencies,
} from "./price-history";
import { displayPriceWadToCents } from "src/shared/venue-prices";
import type { schema } from "src/db/client";

const WAD = 10n ** 18n;
const MOCK_DECIMALS = 18;
const YES_POOL_ID = `0x${"aa".repeat(32)}`;
const NO_POOL_ID = `0x${"bb".repeat(32)}`;
const CREATED_AT = new Date("2026-06-23T12:00:00.000Z");
const GRADUATED_AT = new Date("2026-07-01T00:00:00.000Z");

type ReceiptRow = typeof schema.receiptPlacedEvents.$inferSelect;
type TickRow = typeof schema.poolPriceTicks.$inferSelect;

describe("pregradPricePoints", () => {
  it("opens at the market's creation with the opening probability", () => {
    const points = pregradPricePoints(marketRow(), []);

    expect(points).toHaveLength(1);
    expect(points[0]?.at).toBe(CREATED_AT.toISOString());
    expect(points[0]?.yesCents).toBeCloseTo(50, 6);
    expect(points[0]?.noCents).toBeCloseTo(50, 6);
  });

  it("replays receipts through the shared LMSR, in sequence order", () => {
    const points = pregradPricePoints(marketRow(), [
      receiptRow({ sequence: 1n, shares: 100n * WAD, side: 0 }),
      receiptRow({
        blockTimestamp: new Date("2026-06-23T13:00:00.000Z"),
        sequence: 2n,
        shares: 50n * WAD,
        side: 1,
      }),
    ]);

    expect(points).toHaveLength(3);
    // The final point must equal the one-shot cumulative derivation the live
    // tick emit uses — the same protocol functions, exercised two ways.
    expect(points[2]?.yesCents).toBeCloseTo(
      currentYesPriceCents({
        b: 5_000,
        noShares: 50,
        openingProbability: 50,
        yesShares: 100,
      }),
      9,
    );
    // A YES buy moves YES up; pregrad NO is the exact complement.
    expect(points[1]!.yesCents).toBeGreaterThan(points[0]!.yesCents);
    for (const point of points) {
      expect(point.yesCents + point.noCents).toBeCloseTo(100, 9);
    }
  });
});

describe("downsamplePricePoints", () => {
  const points = Array.from({ length: 10 }, (_, index) => ({
    at: new Date(CREATED_AT.getTime() + index * 1_000).toISOString(),
    noCents: 100 - index,
    yesCents: index,
  }));

  it("returns short histories untouched", () => {
    expect(downsamplePricePoints(points, 10)).toEqual(points);
  });

  it("thins to the cap while keeping the opening and latest samples", () => {
    const thinned = downsamplePricePoints(points, 4);

    expect(thinned).toHaveLength(4);
    expect(thinned[0]).toEqual(points[0]!);
    expect(thinned.at(-1)).toEqual(points.at(-1)!);
  });
});

describe("pregrad opening precision", () => {
  it("replays from the full-precision opening probability, not rounded cents", () => {
    // 55.5%: wadToCents would round to 56 and diverge from the venue handoff,
    // which derives from the unrounded WAD (Codex P3 review finding).
    const points = pregradPricePoints(
      marketRow({ openingProbabilityWad: (WAD * 555n) / 1000n }),
      [],
    );

    expect(points[0]?.yesCents).toBeCloseTo(55.5, 9);
  });

  it("keeps the handoff continuous for a fractional opening probability", async () => {
    const fractional = marketRow({
      openingProbabilityWad: (WAD * 555n) / 1000n,
      yesShares: 100n * WAD,
    });
    const history = await getMarketPriceHistory(
      { chainId: 31337, marketId: "7" },
      createDependencies({ selectMarket: async () => fractional }),
    );

    const handoffIndex = history!.points.findIndex(
      (point) => point.at === GRADUATED_AT.toISOString(),
    );
    expect(handoffIndex).toBeGreaterThan(0);
    expect(history!.points[handoffIndex]!.yesCents).toBeCloseTo(
      history!.points[handoffIndex - 1]!.yesCents,
      6,
    );
  });
});

describe("getMarketPriceHistory", () => {
  it("serves the pregrad path alone for an ungraduated market", async () => {
    const history = await getMarketPriceHistory(
      { chainId: 31337, marketId: "7" },
      createDependencies({ selectGraduatedAt: async () => null }),
    );

    expect(history?.graduatedAt).toBeUndefined();
    // Opening point + one receipt.
    expect(history?.points).toHaveLength(2);
    expect(history?.points[0]?.at).toBe(CREATED_AT.toISOString());
  });

  it("spans the handoff for a graduated market with venue trades", async () => {
    const history = await getMarketPriceHistory(
      { chainId: 31337, marketId: "7" },
      createDependencies(),
    );

    expect(history?.graduatedAt).toBe(GRADUATED_AT.toISOString());
    // Opening + 1 receipt + synthesized handoff + 1 swap.
    expect(history?.points).toHaveLength(4);
    const [, lastPregrad, handoff, swap] = history!.points;
    // The venue opens where the pregrad book closed: the handoff point's YES
    // equals the closing LMSR price (within the ADR 0009 clamp).
    expect(handoff!.at).toBe(GRADUATED_AT.toISOString());
    expect(handoff!.yesCents).toBeCloseTo(lastPregrad!.yesCents, 6);
    // The swap point carries the pool-derived price, not a complement.
    expect(swap!.yesCents).toBeCloseTo(
      displayPriceWadToCents(
        tickToDisplayPriceWad({
          collateralDecimals: MOCK_DECIMALS,
          outcomeDecimals: COMPLETE_SET_PRICE_POLICY.outcomeDecimals,
          outcomeIsCurrency0: true,
          tick: -6960,
        }),
      ),
      9,
    );
  });

  it("reports graduatedAt with no venue points before pools are indexed", async () => {
    const history = await getMarketPriceHistory(
      { chainId: 31337, marketId: "7" },
      createDependencies({ selectVenuePools: async () => [] }),
    );

    expect(history?.graduatedAt).toBe(GRADUATED_AT.toISOString());
    expect(history?.points).toHaveLength(2);
  });

  it("answers null for an unknown or malformed market id", async () => {
    expect(
      await getMarketPriceHistory(
        { chainId: 31337, marketId: "not-a-number" },
        createDependencies(),
      ),
    ).toBeNull();
    expect(
      await getMarketPriceHistory(
        { chainId: 31337, marketId: "7" },
        createDependencies({ selectMarket: async () => null }),
      ),
    ).toBeNull();
  });

  it("caps a long unified history while keeping both ends", async () => {
    const receipts = Array.from({ length: 400 }, (_, index) =>
      receiptRow({
        blockTimestamp: new Date(CREATED_AT.getTime() + index * 1_000),
        logIndex: index,
        sequence: BigInt(index + 1),
        shares: WAD,
        side: index % 2,
      }),
    );
    const history = await getMarketPriceHistory(
      { chainId: 31337, marketId: "7" },
      createDependencies({ selectReceiptEvents: async () => receipts }),
    );

    expect(history?.points).toHaveLength(256);
    expect(history?.points[0]?.at).toBe(CREATED_AT.toISOString());
    // The newest venue point survives the thinning.
    expect(history?.points.at(-1)?.at).toBe("2026-07-01T01:00:00.000Z");
    // And so does the synthesized handoff — per-phase thinning keeps each
    // half's endpoints (Codex P3 review finding).
    expect(
      history?.points.some((point) => point.at === GRADUATED_AT.toISOString()),
    ).toBe(true);
  });

  it("degrades to exact pregrad endpoints past the replay cap", async () => {
    // 5001 receipts exceed REPLAY_RECEIPT_CAP: the pregrad half collapses to
    // its opening and closing states, both exact, so the handoff still lines
    // up with the venue opening while the request stays bounded.
    const receipts = Array.from({ length: 5_001 }, (_, index) =>
      receiptRow({
        blockTimestamp: new Date(CREATED_AT.getTime() + index * 1_000),
        logIndex: index,
        sequence: BigInt(index + 1),
        shares: WAD,
        side: 0,
      }),
    );
    const history = await getMarketPriceHistory(
      { chainId: 31337, marketId: "7" },
      createDependencies({ selectReceiptEvents: async () => receipts }),
    );

    // 2 pregrad endpoint samples + handoff + 1 swap.
    expect(history?.points).toHaveLength(4);
    const [opening, closing, handoff] = history!.points;
    expect(opening!.at).toBe(CREATED_AT.toISOString());
    expect(opening!.yesCents).toBeCloseTo(50, 9);
    // Closing derives from the row's locked shares (100 YES in this fixture),
    // matching the venue handoff exactly.
    expect(closing!.at).toBe(GRADUATED_AT.toISOString());
    expect(handoff!.yesCents).toBeCloseTo(closing!.yesCents, 6);
  });
});

function createDependencies(
  overrides: Partial<PriceHistoryDependencies> = {},
): PriceHistoryDependencies {
  return {
    readCollateralDecimals: async () => MOCK_DECIMALS,
    selectGraduatedAt: async () => GRADUATED_AT,
    // The row's locked shares mirror the receipt list below — the indexer
    // maintains that invariant, and handoff continuity depends on it.
    selectMarket: async () => marketRow({ yesShares: 100n * WAD }),
    selectPoolPriceTicks: async () => [tickRow({ sequence: 1n, tick: -6960 })],
    selectReceiptEvents: async () => [
      receiptRow({ sequence: 1n, shares: 100n * WAD, side: 0 }),
    ],
    selectVenuePools: async () => [
      poolRow({}),
      poolRow({
        id: 2,
        outcomeIsCurrency0: false,
        poolId: NO_POOL_ID,
        side: "no",
      }),
    ],
    ...overrides,
  };
}

function receiptRow(overrides: Partial<ReceiptRow>): ReceiptRow {
  return {
    blockNumber: 200n,
    blockTimestamp: new Date("2026-06-23T12:30:00.000Z"),
    chainId: 31337,
    contractId: 1,
    cost: WAD,
    createdAt: new Date("2026-06-23T12:30:01.000Z"),
    id: 1,
    logIndex: 0,
    marketId: 7n,
    owner: "0x0000000000000000000000000000000000000003",
    rHigh: "0",
    rLow: "0",
    receiptId: 1n,
    sequence: 1n,
    shares: WAD,
    side: 0,
    transactionHash: `0x${"cc".repeat(32)}`,
    ...overrides,
  };
}

function tickRow(overrides: Partial<TickRow>): TickRow {
  return {
    blockNumber: 1_000n,
    blockTimestamp: new Date("2026-07-01T01:00:00.000Z"),
    chainId: 31337,
    contractId: 1,
    createdAt: new Date("2026-07-01T01:00:01.000Z"),
    id: 1n,
    logIndex: 0,
    poolId: YES_POOL_ID,
    sequence: 1n,
    tick: 0,
    transactionHash: `0x${"dd".repeat(32)}`,
    ...overrides,
  };
}

function poolRow(overrides: Partial<VenuePoolRow>): VenuePoolRow {
  return {
    chainId: 31337,
    createdAt: GRADUATED_AT,
    id: 1,
    marketId: 7n,
    outcomeIsCurrency0: true,
    outcomeToken: "0x00000000000000000000000000000000000000e0",
    poolId: YES_POOL_ID,
    postgradMarket: "0x00000000000000000000000000000000000000f0",
    side: "yes",
    ...overrides,
  };
}

function marketRow(overrides: Partial<MarketRow> = {}): MarketRow {
  return {
    bypassAiResolution: false,
    chainId: 31337,
    collateral: "0x0000000000000000000000000000000000000002",
    contractId: 1,
    createdAt: CREATED_AT,
    createdBlockNumber: 123n,
    createdBlockTimestamp: CREATED_AT,
    createdLogIndex: 4,
    createdTransactionHash: `0x${"22".repeat(32)}`,
    creator: "0x0000000000000000000000000000000000000003",
    graduationThreshold: 2_500n * WAD,
    graduationTime: new Date("2026-07-01T00:00:00.000Z"),
    id: 7,
    liquidityParameter: 5_000n * WAD,
    marketId: 7n,
    metadataHash: `0x${"11".repeat(32)}`,
    noShares: 0n,
    openingProbabilityWad: WAD / 2n,
    receiptCount: 0n,
    resolutionTime: new Date("2026-08-01T00:00:00.000Z"),
    yesNotBefore: null,
    status: "graduated",
    totalEscrowed: 0n,
    updatedAt: CREATED_AT,
    yesShares: 0n,
    ...overrides,
  };
}
