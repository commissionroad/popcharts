import { describe, expect, it } from "bun:test";

import {
  COMPLETE_SET_PRICE_POLICY,
  tickToDisplayPriceWad,
} from "@popcharts/protocol";

import type { MarketRow } from "./markets";
import type { VenuePoolRow } from "./venue-orderbook";
import {
  displayPriceWadToCents,
  downsampleVenuePricePoints,
  foldVenuePricePoints,
  getMarketVenuePriceHistory,
  type PoolPriceTickRow,
  type VenuePriceHistoryDependencies,
  venueOpeningPoint,
} from "./venue-price-history";

const WAD = 10n ** 18n;
const MOCK_DECIMALS = 18;
const YES_POOL_ID = `0x${"aa".repeat(32)}`;
const NO_POOL_ID = `0x${"bb".repeat(32)}`;
const GRADUATED_AT = new Date("2026-07-01T00:00:00.000Z");

/** Cents at a tick, via the same conversion the service uses. */
function centsAtTick(tick: number, outcomeIsCurrency0: boolean) {
  return displayPriceWadToCents(
    tickToDisplayPriceWad({
      collateralDecimals: MOCK_DECIMALS,
      outcomeDecimals: COMPLETE_SET_PRICE_POLICY.outcomeDecimals,
      outcomeIsCurrency0,
      tick,
    }),
  );
}

describe("displayPriceWadToCents", () => {
  it("reads a WAD display price as a whole-cent probability", () => {
    expect(displayPriceWadToCents(WAD / 2n)).toBe(50);
    expect(displayPriceWadToCents(0n)).toBe(0);
    expect(displayPriceWadToCents(WAD)).toBe(100);
    expect(displayPriceWadToCents((WAD * 37n) / 100n)).toBe(37);
  });

  it("rounds to the nearest cent", () => {
    expect(displayPriceWadToCents((WAD * 6249n) / 10_000n)).toBe(62);
    expect(displayPriceWadToCents((WAD * 6251n) / 10_000n)).toBe(63);
  });
});

describe("venueOpeningPoint", () => {
  it("opens both pools where the pregrad book closed", () => {
    // Balanced shares at a 50% opening probability close at 50/50.
    const point = venueOpeningPoint(
      {
        liquidityParameter: 5_000n * WAD,
        noShares: 0n,
        openingProbabilityWad: WAD / 2n,
        yesShares: 0n,
      },
      GRADUATED_AT,
    );

    expect(point).toEqual({
      at: "2026-07-01T00:00:00.000Z",
      noPriceCents: 50,
      yesPriceCents: 50,
    });
  });

  it("gives NO the complement of the closing YES price", () => {
    // A YES-heavy book closes above 50%, and the pair still sums to a set.
    const point = venueOpeningPoint(
      {
        liquidityParameter: 1_000n * WAD,
        noShares: 0n,
        openingProbabilityWad: WAD / 2n,
        yesShares: 1_000n * WAD,
      },
      GRADUATED_AT,
    );

    expect(point.yesPriceCents).toBeGreaterThan(50);
    expect(point.yesPriceCents + point.noPriceCents).toBe(100);
  });
});

describe("foldVenuePricePoints", () => {
  const opening = {
    at: GRADUATED_AT.toISOString(),
    noPriceCents: 40,
    yesPriceCents: 60,
  };

  it("leads with the opening point when no swap has landed", () => {
    expect(
      foldVenuePricePoints({
        collateralDecimals: MOCK_DECIMALS,
        opening,
        ticks: [],
      }),
    ).toEqual([opening]);
  });

  it("carries the untouched pool's price forward across a swap", () => {
    const points = foldVenuePricePoints({
      collateralDecimals: MOCK_DECIMALS,
      opening,
      ticks: [
        {
          pool: createPoolRow({}),
          tick: createTickRow({ tick: -6960 }),
        },
      ],
    });

    // A YES swap re-prices YES only; NO still stands where it opened.
    expect(points).toHaveLength(2);
    expect(points[1]).toEqual({
      at: "2026-07-01T01:00:00.000Z",
      noPriceCents: 40,
      yesPriceCents: centsAtTick(-6960, true),
    });
  });

  it("tracks each pool independently as swaps alternate", () => {
    const points = foldVenuePricePoints({
      collateralDecimals: MOCK_DECIMALS,
      opening,
      ticks: [
        { pool: createPoolRow({}), tick: createTickRow({ tick: -6960 }) },
        {
          pool: createPoolRow({
            outcomeIsCurrency0: false,
            poolId: NO_POOL_ID,
            side: "no",
          }),
          tick: createTickRow({ logIndex: 2, poolId: NO_POOL_ID, tick: 6900 }),
        },
      ],
    });

    const yesCents = centsAtTick(-6960, true);

    // The NO swap leaves the YES price from the previous sample standing.
    expect(points[1]?.yesPriceCents).toBe(yesCents);
    expect(points[2]).toEqual({
      at: "2026-07-01T01:00:00.000Z",
      noPriceCents: centsAtTick(6900, false),
      yesPriceCents: yesCents,
    });
  });

  it("respects each pool's currency sort order", () => {
    // The same raw tick prices opposite ways depending on orientation, so a
    // pool row's flag — not the side — decides the conversion.
    const atTick = (outcomeIsCurrency0: boolean) =>
      foldVenuePricePoints({
        collateralDecimals: MOCK_DECIMALS,
        opening,
        ticks: [
          {
            pool: createPoolRow({ outcomeIsCurrency0 }),
            tick: createTickRow({ tick: -6960 }),
          },
        ],
      })[1]?.yesPriceCents;

    expect(atTick(true)).toBe(centsAtTick(-6960, true));
    expect(atTick(false)).toBe(centsAtTick(-6960, false));
    expect(atTick(true)).not.toBe(atTick(false));
  });
});

describe("downsampleVenuePricePoints", () => {
  const points = Array.from({ length: 10 }, (_, index) => ({
    at: new Date(GRADUATED_AT.getTime() + index * 1_000).toISOString(),
    noPriceCents: 100 - index,
    yesPriceCents: index,
  }));

  it("returns short histories untouched", () => {
    expect(downsampleVenuePricePoints(points, 10)).toEqual(points);
    expect(downsampleVenuePricePoints(points, 25)).toEqual(points);
  });

  it("thins to the cap while keeping the opening and latest samples", () => {
    const thinned = downsampleVenuePricePoints(points, 4);

    expect(thinned).toHaveLength(4);
    expect(thinned[0]).toEqual(points[0]!);
    expect(thinned.at(-1)).toEqual(points.at(-1)!);
  });
});

describe("getMarketVenuePriceHistory", () => {
  it("returns the opening point plus one point per swap", async () => {
    const history = await getMarketVenuePriceHistory(
      { chainId: 31337, marketId: "7" },
      createDependencies(),
    );

    expect(history?.graduatedAt).toBe("2026-07-01T00:00:00.000Z");
    expect(history?.points).toHaveLength(2);
    expect(history?.points[0]).toEqual({
      at: "2026-07-01T00:00:00.000Z",
      noPriceCents: 50,
      yesPriceCents: 50,
    });
    expect(history?.points[1]?.yesPriceCents).toBe(centsAtTick(-6960, true));
  });

  it("orders points by chain order, not insertion order", async () => {
    const history = await getMarketVenuePriceHistory(
      { chainId: 31337, marketId: "7" },
      createDependencies({
        selectPoolPriceTicks: async () => [
          createTickRow({ blockNumber: 10n, tick: -6960 }),
          createTickRow({
            blockNumber: 11n,
            blockTimestamp: new Date("2026-07-01T02:00:00.000Z"),
            logIndex: 1,
            tick: -6900,
          }),
        ],
      }),
    );

    expect(history?.points.map((point) => point.at)).toEqual([
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T01:00:00.000Z",
      "2026-07-01T02:00:00.000Z",
    ]);
  });

  it("reports no points for a market that has not graduated", async () => {
    const history = await getMarketVenuePriceHistory(
      { chainId: 31337, marketId: "7" },
      createDependencies({ selectGraduatedAt: async () => null }),
    );

    expect(history).toEqual({ chainId: 31337, marketId: "7", points: [] });
  });

  it("reports no points while the venue pools are not indexed", async () => {
    const history = await getMarketVenuePriceHistory(
      { chainId: 31337, marketId: "7" },
      createDependencies({ selectVenuePools: async () => [] }),
    );

    // Graduated, but nothing to attribute a tick to yet — and the caller can
    // still tell that apart from a market that never graduated.
    expect(history?.points).toEqual([]);
    expect(history?.graduatedAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("drops a tick whose pool is not indexed rather than guessing its side", async () => {
    const history = await getMarketVenuePriceHistory(
      { chainId: 31337, marketId: "7" },
      createDependencies({
        selectPoolPriceTicks: async () => [
          createTickRow({ poolId: `0x${"cc".repeat(32)}`, tick: -6960 }),
        ],
      }),
    );

    expect(history?.points).toHaveLength(1);
  });

  it("answers null for an unknown or malformed market id", async () => {
    expect(
      await getMarketVenuePriceHistory(
        { chainId: 31337, marketId: "not-a-number" },
        createDependencies(),
      ),
    ).toBeNull();
    expect(
      await getMarketVenuePriceHistory(
        { chainId: 31337, marketId: "7" },
        createDependencies({ selectMarket: async () => null }),
      ),
    ).toBeNull();
  });

  it("caps a long history at the downsampling ceiling", async () => {
    const history = await getMarketVenuePriceHistory(
      { chainId: 31337, marketId: "7" },
      createDependencies({
        selectPoolPriceTicks: async () =>
          Array.from({ length: 500 }, (_, index) =>
            createTickRow({
              blockNumber: BigInt(index),
              blockTimestamp: new Date(GRADUATED_AT.getTime() + index * 1_000),
              logIndex: index,
              tick: -6960,
            }),
          ),
      }),
    );

    expect(history?.points).toHaveLength(240);
  });
});

function createDependencies(
  overrides: Partial<VenuePriceHistoryDependencies> = {},
): VenuePriceHistoryDependencies {
  return {
    readCollateralDecimals: async () => MOCK_DECIMALS,
    selectGraduatedAt: async () => GRADUATED_AT,
    selectMarket: async () => createMarketRow(),
    selectPoolPriceTicks: async () => [createTickRow({ tick: -6960 })],
    selectVenuePools: async () => [
      createPoolRow({}),
      createPoolRow({
        id: 2,
        outcomeIsCurrency0: false,
        poolId: NO_POOL_ID,
        side: "no",
      }),
    ],
    ...overrides,
  };
}

function createTickRow(overrides: Partial<PoolPriceTickRow>): PoolPriceTickRow {
  return {
    blockNumber: 1_000n,
    blockTimestamp: new Date("2026-07-01T01:00:00.000Z"),
    chainId: 31337,
    contractId: 1,
    createdAt: new Date("2026-07-01T01:00:01.000Z"),
    id: 1n,
    logIndex: 0,
    poolId: YES_POOL_ID,
    tick: 0,
    transactionHash: `0x${"dd".repeat(32)}`,
    ...overrides,
  };
}

function createPoolRow(overrides: Partial<VenuePoolRow>): VenuePoolRow {
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

function createMarketRow(): MarketRow {
  return {
    bypassAiResolution: false,
    chainId: 31337,
    collateral: "0x0000000000000000000000000000000000000002",
    contractId: 1,
    createdAt: new Date("2026-06-23T12:00:00.000Z"),
    createdBlockNumber: 123n,
    createdBlockTimestamp: new Date("2026-06-23T11:59:00.000Z"),
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
    updatedAt: new Date("2026-06-23T12:01:00.000Z"),
    yesShares: 0n,
  };
}
