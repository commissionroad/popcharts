import { describe, expect, it } from "bun:test";

import {
  displayPriceWadToSqrtPriceX96,
  liquidityForAmounts,
  sqrtPriceX96ToDisplayPriceWad,
  tickToSqrtPriceX96,
} from "@popcharts/protocol";

import type { MarketRow } from "./markets";
import {
  aggregateVenueOrderBookLevels,
  buildVenueOrderBookPool,
  getMarketOrderBook,
  getMarketVenueOrders,
  venueOrderDirection,
  venueOrderOutcomeSize,
  venueOrderPriceWad,
  type VenueOrderReadDependencies,
  type VenueOrderRow,
  type VenuePoolRow,
} from "./venue-orderbook";

const WAD = 10n ** 18n;
// 18-decimal mock collateral against 18-decimal outcome tokens, both currency
// sort orders — the same orientations the protocol golden tests cover.
const MOCK_DECIMALS = 18;
const OUTCOME_IS_CURRENCY0 = {
  collateralDecimals: MOCK_DECIMALS,
  outcomeIsCurrency0: true,
};
const COLLATERAL_IS_CURRENCY0 = {
  collateralDecimals: MOCK_DECIMALS,
  outcomeIsCurrency0: false,
};
// Golden display prices from protocol/test/nodejs/display-price-conversion:
// ticks ±6960 and ±6900 bracket a 0.5 pool price one spacing away.
const DISPLAY_AT_MINUS_6960 = 498592972568148699n;
const DISPLAY_AT_MINUS_6900 = 501593372585363963n;

const YES_POOL_ID = `0x${"aa".repeat(32)}`;
const NO_POOL_ID = `0x${"bb".repeat(32)}`;

describe("venueOrderDirection", () => {
  it("marks makers supplying the outcome token as asks in both sort orders", () => {
    expect(
      venueOrderDirection({ outcomeIsCurrency0: true, zeroForOne: true }),
    ).toBe("ask");
    expect(
      venueOrderDirection({ outcomeIsCurrency0: false, zeroForOne: false }),
    ).toBe("ask");
  });

  it("marks makers supplying collateral as bids in both sort orders", () => {
    expect(
      venueOrderDirection({ outcomeIsCurrency0: true, zeroForOne: false }),
    ).toBe("bid");
    expect(
      venueOrderDirection({ outcomeIsCurrency0: false, zeroForOne: true }),
    ).toBe("bid");
  });
});

describe("venueOrderPriceWad", () => {
  it("quotes asks at the minimum display price of the range", () => {
    expect(
      venueOrderPriceWad({
        direction: "ask",
        pricing: OUTCOME_IS_CURRENCY0,
        tickLower: -6960,
        tickUpper: -6900,
      }),
    ).toBe(DISPLAY_AT_MINUS_6960);
    // With collateral as currency0 the display price falls as ticks rise, so
    // the same display range maps to mirrored positive ticks.
    expect(
      venueOrderPriceWad({
        direction: "ask",
        pricing: COLLATERAL_IS_CURRENCY0,
        tickLower: 6900,
        tickUpper: 6960,
      }),
    ).toBe(DISPLAY_AT_MINUS_6960);
  });

  it("quotes bids at the maximum display price of the range", () => {
    expect(
      venueOrderPriceWad({
        direction: "bid",
        pricing: OUTCOME_IS_CURRENCY0,
        tickLower: -6960,
        tickUpper: -6900,
      }),
    ).toBe(DISPLAY_AT_MINUS_6900);
    expect(
      venueOrderPriceWad({
        direction: "bid",
        pricing: COLLATERAL_IS_CURRENCY0,
        tickLower: 6900,
        tickUpper: 6960,
      }),
    ).toBe(DISPLAY_AT_MINUS_6900);
  });
});

describe("venueOrderOutcomeSize", () => {
  it("converts liquidity to the currency0 outcome amount", () => {
    // Golden value cross-checked against LiquidityAmounts round-trips below;
    // ~4.24 outcome tokens sell for ~2.12 collateral around price 0.5.
    expect(
      venueOrderOutcomeSize({
        liquidity: 1_000n * WAD,
        outcomeIsCurrency0: true,
        tickLower: -6960,
        tickUpper: -6900,
      }),
    ).toBe(4242044480683814121n);
  });

  it("round-trips through the protocol liquidityForAmounts math", () => {
    const liquidity = 1_000n * WAD;

    for (const { outcomeIsCurrency0, tickLower, tickUpper } of [
      { outcomeIsCurrency0: true, tickLower: -6960, tickUpper: -6900 },
      { outcomeIsCurrency0: false, tickLower: 6900, tickUpper: 6960 },
    ]) {
      const size = venueOrderOutcomeSize({
        liquidity,
        outcomeIsCurrency0,
        tickLower,
        tickUpper,
      });
      const sqrtPriceLowerX96 = tickToSqrtPriceX96(tickLower);
      const sqrtPriceUpperX96 = tickToSqrtPriceX96(tickUpper);
      // Recover liquidity from the amount with the pool price outside the
      // range on the outcome side; rounding may only lose liquidity.
      const recovered = liquidityForAmounts({
        amount0Max: outcomeIsCurrency0 ? size : 0n,
        amount1Max: outcomeIsCurrency0 ? 0n : size,
        sqrtPriceLowerX96,
        sqrtPriceUpperX96,
        sqrtPriceX96: outcomeIsCurrency0
          ? sqrtPriceLowerX96 - 1n
          : sqrtPriceUpperX96 + 1n,
      });

      expect(recovered <= liquidity).toBe(true);
      expect(liquidity - recovered < 1_000n).toBe(true);
    }
  });

  it("rejects inverted tick ranges", () => {
    expect(() =>
      venueOrderOutcomeSize({
        liquidity: WAD,
        outcomeIsCurrency0: true,
        tickLower: -6900,
        tickUpper: -6960,
      }),
    ).toThrow(/tickLower/);
  });
});

describe("aggregateVenueOrderBookLevels", () => {
  it("sums remaining liquidity for orders sharing a direction and range", () => {
    const { asks, bids } = aggregateVenueOrderBookLevels({
      orders: [
        createOrderRow({ liquidity: 600n * WAD, zeroForOne: true }),
        createOrderRow({ liquidity: 400n * WAD, orderId: 2, zeroForOne: true }),
      ],
      pricing: OUTCOME_IS_CURRENCY0,
    });

    expect(bids).toEqual([]);
    expect(asks).toEqual([
      {
        orderCount: 2,
        priceWad: DISPLAY_AT_MINUS_6960.toString(),
        sizeWad: venueOrderOutcomeSize({
          liquidity: 1_000n * WAD,
          outcomeIsCurrency0: true,
          tickLower: -6960,
          tickUpper: -6900,
        }).toString(),
        tickLower: -6960,
        tickUpper: -6900,
      },
    ]);
  });

  it("uses remaining liquidity for partially filled orders", () => {
    const { asks } = aggregateVenueOrderBookLevels({
      orders: [
        createOrderRow({
          liquidity: 1_000n * WAD,
          remainingLiquidity: 250n * WAD,
          zeroForOne: true,
        }),
      ],
      pricing: OUTCOME_IS_CURRENCY0,
    });

    expect(asks[0]?.sizeWad).toBe(
      venueOrderOutcomeSize({
        liquidity: 250n * WAD,
        outcomeIsCurrency0: true,
        tickLower: -6960,
        tickUpper: -6900,
      }).toString(),
    );
  });

  it("classifies both directions and sorts asks up and bids down", () => {
    const { asks, bids } = aggregateVenueOrderBookLevels({
      orders: [
        // Asks above the 0.5 pool price at two ranges (farther one first).
        createOrderRow({
          tickLower: -6840,
          tickUpper: -6780,
          zeroForOne: true,
        }),
        createOrderRow({
          orderId: 2,
          tickLower: -6900,
          tickUpper: -6840,
          zeroForOne: true,
        }),
        // Bids below the pool price at two ranges (farther one first).
        createOrderRow({
          orderId: 3,
          tickLower: -7080,
          tickUpper: -7020,
          zeroForOne: false,
        }),
        createOrderRow({
          orderId: 4,
          tickLower: -7020,
          tickUpper: -6960,
          zeroForOne: false,
        }),
      ],
      pricing: OUTCOME_IS_CURRENCY0,
    });

    expect(asks.map((level) => level.tickLower)).toEqual([-6900, -6840]);
    expect(bids.map((level) => level.tickUpper)).toEqual([-6960, -7020]);
    expect(BigInt(asks[0]!.priceWad) < BigInt(asks[1]!.priceWad)).toBe(true);
    expect(BigInt(bids[0]!.priceWad) > BigInt(bids[1]!.priceWad)).toBe(true);
    // Best bid rests below best ask, so the aggregated book never crosses.
    expect(BigInt(bids[0]!.priceWad) < BigInt(asks[0]!.priceWad)).toBe(true);
  });

  it("drops drained levels and returns empty sides for no orders", () => {
    expect(
      aggregateVenueOrderBookLevels({
        orders: [createOrderRow({ remainingLiquidity: 0n })],
        pricing: OUTCOME_IS_CURRENCY0,
      }),
    ).toEqual({ asks: [], bids: [] });
    expect(
      aggregateVenueOrderBookLevels({
        orders: [],
        pricing: OUTCOME_IS_CURRENCY0,
      }),
    ).toEqual({ asks: [], bids: [] });
  });
});

describe("buildVenueOrderBookPool", () => {
  it("reports the pool's current display price when initialized", () => {
    const sqrtPriceX96 = displayPriceWadToSqrtPriceX96({
      collateralDecimals: MOCK_DECIMALS,
      displayPriceWad: WAD / 2n,
      outcomeDecimals: 18,
      outcomeIsCurrency0: true,
    });
    const book = buildVenueOrderBookPool({
      collateralDecimals: MOCK_DECIMALS,
      orders: [],
      pool: createPoolRow({ side: "yes" }),
      sqrtPriceX96,
    });

    expect(book).toEqual({
      asks: [],
      bids: [],
      marketPriceWad: sqrtPriceX96ToDisplayPriceWad({
        collateralDecimals: MOCK_DECIMALS,
        outcomeDecimals: 18,
        outcomeIsCurrency0: true,
        sqrtPriceX96,
      }).toString(),
      outcomeTokenAddress: "0x00000000000000000000000000000000000000e0",
      poolId: YES_POOL_ID,
      side: "yes",
    });
  });

  it("omits the market price for uninitialized or unread pools", () => {
    for (const sqrtPriceX96 of [0n, undefined]) {
      const book = buildVenueOrderBookPool({
        collateralDecimals: MOCK_DECIMALS,
        orders: [],
        pool: createPoolRow({}),
        sqrtPriceX96,
      });

      expect(book.marketPriceWad).toBeUndefined();
    }
  });
});

describe("getMarketOrderBook", () => {
  it("returns null for malformed and unknown market ids", async () => {
    expect(
      await getMarketOrderBook(
        { chainId: 31337, marketId: "not-a-market" },
        createDependencies({}),
      ),
    ).toBeNull();
    expect(
      await getMarketOrderBook(
        { chainId: 31337, marketId: "7" },
        createDependencies({ selectMarket: async () => null }),
      ),
    ).toBeNull();
  });

  it("returns a book without ladders for a market with no venue pools", async () => {
    expect(
      await getMarketOrderBook(
        { chainId: 31337, marketId: "7" },
        createDependencies({}),
      ),
    ).toEqual({ chainId: 31337, marketId: "7" });
  });

  it("assembles per-side ladders from pools, orders, and pool prices", async () => {
    const yesPool = createPoolRow({ side: "yes" });
    const noPool = createPoolRow({
      id: 2,
      outcomeIsCurrency0: false,
      poolId: NO_POOL_ID,
      side: "no",
    });
    const yesSqrtPriceX96 = displayPriceWadToSqrtPriceX96({
      collateralDecimals: MOCK_DECIMALS,
      displayPriceWad: WAD / 2n,
      outcomeDecimals: 18,
      outcomeIsCurrency0: true,
    });
    const orderBook = await getMarketOrderBook(
      { chainId: 31337, marketId: "7" },
      createDependencies({
        readPoolSqrtPricesX96: async () =>
          new Map([[YES_POOL_ID, yesSqrtPriceX96]]),
        selectOpenOrders: async () => [
          createOrderRow({ zeroForOne: true }),
          createOrderRow({
            orderId: 2,
            poolId: NO_POOL_ID,
            tickLower: 6900,
            tickUpper: 6960,
            zeroForOne: false,
          }),
        ],
        selectVenuePools: async () => [yesPool, noPool],
      }),
    );

    expect(orderBook?.yes?.asks).toHaveLength(1);
    expect(orderBook?.yes?.bids).toHaveLength(0);
    expect(orderBook?.yes?.asks[0]?.priceWad).toBe(
      DISPLAY_AT_MINUS_6960.toString(),
    );
    expect(orderBook?.yes?.marketPriceWad).toBeDefined();
    // The NO pool sorts collateral first, so zeroForOne=false supplies the
    // outcome token: an ask on NO, priced off the mirrored tick range.
    expect(orderBook?.no?.asks[0]?.priceWad).toBe(
      DISPLAY_AT_MINUS_6960.toString(),
    );
    expect(orderBook?.no?.marketPriceWad).toBeUndefined();
  });
});

describe("getMarketVenueOrders", () => {
  it("rejects malformed owner addresses before any reads", async () => {
    const result = await getMarketVenueOrders(
      { chainId: 31337, marketId: "7", owner: "0x1234" },
      createDependencies({
        selectMarket: async () => {
          throw new Error("unexpected read");
        },
      }),
    );

    expect(result).toMatchObject({ kind: "invalid_owner" });
  });

  it("reports unknown markets for malformed and unindexed ids", async () => {
    const dependencies = createDependencies({
      selectMarket: async () => null,
    });

    expect(
      await getMarketVenueOrders(
        { chainId: 31337, marketId: "not-a-market", owner: OWNER },
        dependencies,
      ),
    ).toMatchObject({ kind: "unknown_market" });
    expect(
      await getMarketVenueOrders(
        { chainId: 31337, marketId: "7", owner: OWNER },
        dependencies,
      ),
    ).toMatchObject({ kind: "unknown_market" });
  });

  it("lowercases the owner and defaults to open orders", async () => {
    const receivedFilters: { owner: string; statuses: string[] | null }[] = [];
    const result = await getMarketVenueOrders(
      {
        chainId: 31337,
        marketId: "7",
        owner: OWNER.toUpperCase().replace("0X", "0x"),
      },
      createDependencies({
        selectOwnerOrders: async ({ owner, statuses }) => {
          receivedFilters.push({ owner, statuses });
          return [];
        },
      }),
    );

    expect(result).toEqual({ kind: "orders", orders: [] });
    expect(receivedFilters).toEqual([{ owner: OWNER, statuses: ["open"] }]);
  });

  it("passes status=all through as an unfiltered read", async () => {
    const receivedStatuses: (string[] | null)[] = [];
    await getMarketVenueOrders(
      { chainId: 31337, marketId: "7", owner: OWNER, status: "all" },
      createDependencies({
        selectOwnerOrders: async ({ statuses }) => {
          receivedStatuses.push(statuses);
          return [];
        },
      }),
    );

    expect(receivedStatuses).toEqual([null]);
  });

  it("serializes orders with ladder pricing and both size figures", async () => {
    const result = await getMarketVenueOrders(
      { chainId: 31337, marketId: "7", owner: OWNER },
      createDependencies({
        selectOwnerOrders: async () => [
          {
            order: createOrderRow({
              remainingLiquidity: 250n * WAD,
              zeroForOne: false,
            }),
            pool: createPoolRow({ side: "yes" }),
          },
        ],
      }),
    );

    expect(result).toEqual({
      kind: "orders",
      orders: [
        {
          amountIn: (500n * WAD).toString(),
          createdBlockTimestamp: "2026-07-01T00:00:00.000Z",
          createdTransactionHash: `0x${"cc".repeat(32)}`,
          direction: "bid",
          orderId: 1,
          owner: OWNER,
          poolId: YES_POOL_ID,
          priceWad: DISPLAY_AT_MINUS_6900.toString(),
          remainingSizeWad: venueOrderOutcomeSize({
            liquidity: 250n * WAD,
            outcomeIsCurrency0: true,
            tickLower: -6960,
            tickUpper: -6900,
          }).toString(),
          side: "yes",
          sizeWad: venueOrderOutcomeSize({
            liquidity: 1_000n * WAD,
            outcomeIsCurrency0: true,
            tickLower: -6960,
            tickUpper: -6900,
          }).toString(),
          status: "open",
          tickLower: -6960,
          tickUpper: -6900,
        },
      ],
    });
  });

  it("skips the collateral decimals read when the owner has no orders", async () => {
    let decimalsRead = false;
    await getMarketVenueOrders(
      { chainId: 31337, marketId: "7", owner: OWNER },
      createDependencies({
        readCollateralDecimals: async () => {
          decimalsRead = true;
          return MOCK_DECIMALS;
        },
      }),
    );

    expect(decimalsRead).toBe(false);
  });
});

const OWNER = "0x00000000000000000000000000000000000000aa";

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
    creator: OWNER,
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

function createPoolRow(overrides: Partial<VenuePoolRow>): VenuePoolRow {
  return {
    chainId: 31337,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
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

function createOrderRow(overrides: Partial<VenueOrderRow>): VenueOrderRow {
  return {
    amountIn: 500n * WAD,
    chainId: 31337,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    createdBlockNumber: 1_000n,
    createdBlockTimestamp: new Date("2026-07-01T00:00:00.000Z"),
    createdLogIndex: 1,
    createdTransactionHash: `0x${"cc".repeat(32)}`,
    enablePartialFill: null,
    filledAmount0: 0n,
    filledAmount1: 0n,
    id: 1,
    indexedTick: null,
    liquidity: 1_000n * WAD,
    orderId: 1,
    owner: OWNER,
    poolId: YES_POOL_ID,
    remainingLiquidity: overrides.liquidity ?? 1_000n * WAD,
    status: "open",
    tickLower: -6960,
    tickUpper: -6900,
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedBlockNumber: 1_000n,
    updatedLogIndex: 1,
    zeroForOne: true,
    ...overrides,
  };
}

function createDependencies(
  overrides: Partial<VenueOrderReadDependencies>,
): VenueOrderReadDependencies {
  return {
    readCollateralDecimals: async () => MOCK_DECIMALS,
    readPoolSqrtPricesX96: async () => new Map(),
    selectMarket: async () => createMarketRow(),
    selectOpenOrders: async () => [],
    selectOwnerOrders: async () => [],
    selectVenuePools: async () => [],
    ...overrides,
  };
}
