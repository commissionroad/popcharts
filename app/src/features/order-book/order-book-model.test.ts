import type {
  MarketOrderBook,
  VenueOrderBookLevel,
  VenueOrderBookPool,
} from "@popcharts/api-client/models";
import { describe, expect, it } from "vitest";

import { buildOrderBookPoolView, hasIndexedPools } from "./order-book-model";

describe("buildOrderBookPoolView", () => {
  it("converts WAD levels to cents and shares with cumulative depth", () => {
    const view = buildOrderBookPoolView(
      poolFactory({
        asks: [
          levelFactory({
            priceWad: "660000000000000000",
            sizeWad: "10000000000000000000",
          }),
          levelFactory({
            orderCount: 2,
            priceWad: "700000000000000000",
            sizeWad: "25000000000000000000",
          }),
        ],
        bids: [
          levelFactory({
            priceWad: "620000000000000000",
            sizeWad: "5000000000000000000",
          }),
          levelFactory({
            priceWad: "600000000000000000",
            sizeWad: "40000000000000000000",
          }),
        ],
        marketPriceWad: "640000000000000000",
      })
    );

    expect(view.asks).toEqual([
      { cumulativeShares: 10, orderCount: 1, priceCents: 66, sizeShares: 10 },
      { cumulativeShares: 35, orderCount: 2, priceCents: 70, sizeShares: 25 },
    ]);
    expect(view.bids).toEqual([
      { cumulativeShares: 5, orderCount: 1, priceCents: 62, sizeShares: 5 },
      { cumulativeShares: 45, orderCount: 1, priceCents: 60, sizeShares: 40 },
    ]);
    expect(view.marketPriceCents).toBe(64);
    expect(view.maxCumulativeShares).toBe(45);
    expect(view.spreadCents).toBe(4);
  });

  it("decodes fractional share sizes precisely", () => {
    const view = buildOrderBookPoolView(
      poolFactory({
        asks: [
          levelFactory({ sizeWad: "1500000000000000000" }),
          levelFactory({ sizeWad: "2250000000000000000" }),
        ],
        bids: [],
      })
    );

    expect(view.asks.map((level) => level.sizeShares)).toEqual([1.5, 2.25]);
    expect(view.asks.map((level) => level.cumulativeShares)).toEqual([1.5, 3.75]);
  });

  it("returns a null spread when either half of the book is empty", () => {
    const asksOnly = buildOrderBookPoolView(
      poolFactory({
        asks: [levelFactory({ priceWad: "660000000000000000" })],
        bids: [],
      })
    );
    const bidsOnly = buildOrderBookPoolView(
      poolFactory({
        asks: [],
        bids: [levelFactory({ priceWad: "600000000000000000" })],
      })
    );

    expect(asksOnly.spreadCents).toBeNull();
    expect(bidsOnly.spreadCents).toBeNull();
  });

  it("handles an entirely empty book", () => {
    const view = buildOrderBookPoolView(poolFactory({ asks: [], bids: [] }));

    expect(view.asks).toEqual([]);
    expect(view.bids).toEqual([]);
    expect(view.maxCumulativeShares).toBe(0);
    expect(view.spreadCents).toBeNull();
  });

  it("reports a null pool price while the pool is uninitialized", () => {
    const pool = poolFactory({ asks: [], bids: [] });
    delete pool.marketPriceWad;

    expect(buildOrderBookPoolView(pool).marketPriceCents).toBeNull();
  });
});

describe("hasIndexedPools", () => {
  it("is true when either outcome pool is present", () => {
    expect(hasIndexedPools(bookFactory({ yes: poolFactory() }))).toBe(true);
    expect(hasIndexedPools(bookFactory({ no: poolFactory() }))).toBe(true);
  });

  it("is false when the indexer has seen no venue pools", () => {
    expect(hasIndexedPools(bookFactory())).toBe(false);
  });
});

function bookFactory(overrides: Partial<MarketOrderBook> = {}): MarketOrderBook {
  return {
    chainId: 31337,
    marketId: "1",
    ...overrides,
  };
}

function levelFactory(
  overrides: Partial<VenueOrderBookLevel> = {}
): VenueOrderBookLevel {
  return {
    orderCount: 1,
    priceWad: "660000000000000000",
    sizeWad: "10000000000000000000",
    tickLower: -100,
    tickUpper: 0,
    ...overrides,
  };
}

function poolFactory(overrides: Partial<VenueOrderBookPool> = {}): VenueOrderBookPool {
  return {
    asks: [levelFactory()],
    bids: [],
    marketPriceWad: "640000000000000000",
    outcomeTokenAddress: "0x00000000000000000000000000000000000000d1",
    poolId: `0x${"1f".repeat(32)}`,
    side: "yes",
    ...overrides,
  };
}
