import {
  COMPLETE_SET_PRICE_POLICY,
  sqrtPriceX96ToDisplayPriceWad,
  tickToDisplayPriceWad,
  tickToSqrtPriceX96,
} from "@popcharts/protocol";

import type {
  MarketOrderBookResponse,
  VenueOrderBookLevelResponse,
  VenueOrderBookPoolResponse,
  VenueOrderDirectionResponse,
  VenueOrderResponse,
  VenueOrderStatusResponse,
} from "src/api/models/markets";
import { and, db, desc, eq, inArray, schema } from "src/db/client";
import { VENUE_ORDER_STATUSES } from "src/db/schema/venue-orders";

import { selectLiveMarketRow, type MarketRow } from "./markets";
import {
  readCollateralDecimals,
  readPoolSqrtPricesX96,
} from "./postgrad-venue";

/**
 * Read API over the venue order projections PR #143 indexes: the aggregated
 * depth ladder for a graduated market's outcome pools and one wallet's maker
 * orders. All price and size math is deterministic off the indexed rows; the
 * only chain reads are the collateral's decimals (memoized) and each pool's
 * current slot0 price.
 */

const Q96 = 1n << 96n;

/** Drizzle select shape of a venue_pools row. */
export type VenuePoolRow = typeof schema.venuePools.$inferSelect;
/** Drizzle select shape of a venue_orders row. */
export type VenueOrderRow = typeof schema.venueOrders.$inferSelect;

/** Decimal and currency-sort context needed to price one outcome pool. */
export type VenuePoolPricing = {
  readonly collateralDecimals: number;
  readonly outcomeIsCurrency0: boolean;
};

/**
 * Classifies a maker order as a bid or ask on its outcome token. The
 * order's zeroForOne flag records that the maker supplied currency0, so the
 * maker is selling outcome tokens for collateral (an ask) exactly when the
 * supplied currency is the outcome token; otherwise the maker deposited
 * collateral to buy outcome tokens (a bid).
 */
export function venueOrderDirection({
  outcomeIsCurrency0,
  zeroForOne,
}: {
  readonly outcomeIsCurrency0: boolean;
  readonly zeroForOne: boolean;
}): VenueOrderDirectionResponse {
  return zeroForOne === outcomeIsCurrency0 ? "ask" : "bid";
}

/**
 * Ladder price for an order or level: the display price (collateral per
 * outcome token, WAD) at the tick-range edge nearest the current pool price,
 * which is where the range starts to fill. Asks therefore quote the minimum
 * display price of their range and bids the maximum, so the book never
 * appears crossed and touching a level means fills begin.
 */
export function venueOrderPriceWad({
  direction,
  pricing,
  tickLower,
  tickUpper,
}: {
  readonly direction: VenueOrderDirectionResponse;
  readonly pricing: VenuePoolPricing;
  readonly tickLower: number;
  readonly tickUpper: number;
}): bigint {
  const orientation = {
    collateralDecimals: pricing.collateralDecimals,
    outcomeDecimals: COMPLETE_SET_PRICE_POLICY.outcomeDecimals,
    outcomeIsCurrency0: pricing.outcomeIsCurrency0,
  };
  const lowerPrice = tickToDisplayPriceWad({ ...orientation, tick: tickLower });
  const upperPrice = tickToDisplayPriceWad({ ...orientation, tick: tickUpper });
  const minPrice = lowerPrice < upperPrice ? lowerPrice : upperPrice;
  const maxPrice = lowerPrice < upperPrice ? upperPrice : lowerPrice;

  return direction === "ask" ? minPrice : maxPrice;
}

/**
 * Converts pool liquidity across [tickLower, tickUpper] into the outcome-token
 * quantity it represents, via the v4-periphery LiquidityAmounts
 * getAmount0/1ForLiquidity formulas (rounded down). For asks this is the
 * outcome inventory remaining for sale; for bids it is the outcome quantity
 * the deposited collateral buys when the range fills. Outcome tokens use 18
 * decimals (ADR 0009), so the raw amount is WAD-scaled.
 */
export function venueOrderOutcomeSize({
  liquidity,
  outcomeIsCurrency0,
  tickLower,
  tickUpper,
}: {
  readonly liquidity: bigint;
  readonly outcomeIsCurrency0: boolean;
  readonly tickLower: number;
  readonly tickUpper: number;
}): bigint {
  if (tickLower >= tickUpper) {
    throw new Error(
      `Expected tickLower ${tickLower} to be below tickUpper ${tickUpper}.`,
    );
  }

  const sqrtLower = tickToSqrtPriceX96(tickLower);
  const sqrtUpper = tickToSqrtPriceX96(tickUpper);

  if (outcomeIsCurrency0) {
    return (
      ((liquidity << 96n) * (sqrtUpper - sqrtLower)) / sqrtUpper / sqrtLower
    );
  }

  return (liquidity * (sqrtUpper - sqrtLower)) / Q96;
}

/**
 * Aggregates open maker orders into ladder levels: remaining liquidity is
 * summed per (direction, tickLower, tickUpper) bucket before conversion, so
 * two orders at the same range merge into one level. Asks sort best (lowest
 * price) first, bids best (highest price) first; drained buckets are dropped.
 */
export function aggregateVenueOrderBookLevels({
  orders,
  pricing,
}: {
  readonly orders: readonly VenueOrderRow[];
  readonly pricing: VenuePoolPricing;
}): {
  asks: VenueOrderBookLevelResponse[];
  bids: VenueOrderBookLevelResponse[];
} {
  type LevelBucket = {
    direction: VenueOrderDirectionResponse;
    orderCount: number;
    remainingLiquidity: bigint;
    tickLower: number;
    tickUpper: number;
  };

  const buckets = new Map<string, LevelBucket>();

  for (const order of orders) {
    const direction = venueOrderDirection({
      outcomeIsCurrency0: pricing.outcomeIsCurrency0,
      zeroForOne: order.zeroForOne,
    });
    const key = `${direction}:${order.tickLower}:${order.tickUpper}`;
    const bucket = buckets.get(key) ?? {
      direction,
      orderCount: 0,
      remainingLiquidity: 0n,
      tickLower: order.tickLower,
      tickUpper: order.tickUpper,
    };

    bucket.orderCount += 1;
    bucket.remainingLiquidity += order.remainingLiquidity;
    buckets.set(key, bucket);
  }

  const toLevel = (bucket: LevelBucket): VenueOrderBookLevelResponse => ({
    orderCount: bucket.orderCount,
    priceWad: venueOrderPriceWad({
      direction: bucket.direction,
      pricing,
      tickLower: bucket.tickLower,
      tickUpper: bucket.tickUpper,
    }).toString(),
    sizeWad: venueOrderOutcomeSize({
      liquidity: bucket.remainingLiquidity,
      outcomeIsCurrency0: pricing.outcomeIsCurrency0,
      tickLower: bucket.tickLower,
      tickUpper: bucket.tickUpper,
    }).toString(),
    tickLower: bucket.tickLower,
    tickUpper: bucket.tickUpper,
  });
  const levels = Array.from(buckets.values()).filter(
    (bucket) => bucket.remainingLiquidity > 0n,
  );
  const byPriceWad = (ascending: boolean) => {
    return (a: VenueOrderBookLevelResponse, b: VenueOrderBookLevelResponse) => {
      const difference = BigInt(a.priceWad) - BigInt(b.priceWad);
      const sign = difference < 0n ? -1 : difference > 0n ? 1 : 0;

      return ascending ? sign : -sign;
    };
  };

  return {
    asks: levels
      .filter((bucket) => bucket.direction === "ask")
      .map(toLevel)
      .sort(byPriceWad(true)),
    bids: levels
      .filter((bucket) => bucket.direction === "bid")
      .map(toLevel)
      .sort(byPriceWad(false)),
  };
}

/**
 * Builds the depth ladder for one outcome pool from its indexed open orders
 * and (optionally) the pool's current slot0 sqrt price. A missing or zero
 * sqrt price omits marketPriceWad rather than failing the book.
 */
export function buildVenueOrderBookPool({
  collateralDecimals,
  orders,
  pool,
  sqrtPriceX96,
}: {
  readonly collateralDecimals: number;
  readonly orders: readonly VenueOrderRow[];
  readonly pool: VenuePoolRow;
  readonly sqrtPriceX96: bigint | undefined;
}): VenueOrderBookPoolResponse {
  const pricing = {
    collateralDecimals,
    outcomeIsCurrency0: pool.outcomeIsCurrency0,
  };
  const { asks, bids } = aggregateVenueOrderBookLevels({ orders, pricing });

  return {
    asks,
    bids,
    ...(sqrtPriceX96 !== undefined && sqrtPriceX96 > 0n
      ? {
          marketPriceWad: sqrtPriceX96ToDisplayPriceWad({
            collateralDecimals,
            outcomeDecimals: COMPLETE_SET_PRICE_POLICY.outcomeDecimals,
            outcomeIsCurrency0: pool.outcomeIsCurrency0,
            sqrtPriceX96,
          }).toString(),
        }
      : {}),
    outcomeTokenAddress: pool.outcomeToken,
    poolId: pool.poolId,
    side: pool.side,
  };
}

/**
 * Maps one indexed maker order (plus its pool) to the API shape. Sizes are
 * derived from the order's current tick range, so after a partial-fill
 * requeue sizeWad tracks the requeued range; amountIn stays the exact
 * original deposit.
 */
export function serializeVenueOrder({
  collateralDecimals,
  order,
  pool,
}: {
  readonly collateralDecimals: number;
  readonly order: VenueOrderRow;
  readonly pool: VenuePoolRow;
}): VenueOrderResponse {
  const direction = venueOrderDirection({
    outcomeIsCurrency0: pool.outcomeIsCurrency0,
    zeroForOne: order.zeroForOne,
  });
  const range = {
    outcomeIsCurrency0: pool.outcomeIsCurrency0,
    tickLower: order.tickLower,
    tickUpper: order.tickUpper,
  };

  return {
    amountIn: order.amountIn.toString(),
    createdBlockTimestamp: order.createdBlockTimestamp.toISOString(),
    createdTransactionHash: order.createdTransactionHash,
    direction,
    orderId: order.orderId,
    owner: order.owner,
    poolId: order.poolId,
    priceWad: venueOrderPriceWad({
      direction,
      pricing: {
        collateralDecimals,
        outcomeIsCurrency0: pool.outcomeIsCurrency0,
      },
      tickLower: order.tickLower,
      tickUpper: order.tickUpper,
    }).toString(),
    remainingSizeWad: venueOrderOutcomeSize({
      ...range,
      liquidity: order.remainingLiquidity,
    }).toString(),
    side: pool.side,
    sizeWad: venueOrderOutcomeSize({
      ...range,
      liquidity: order.liquidity,
    }).toString(),
    status: order.status,
    tickLower: order.tickLower,
    tickUpper: order.tickUpper,
  };
}

/**
 * Status filter accepted by the market orders read: any indexed order status,
 * plus `all` to opt out of the default open-only filter. Extends
 * VENUE_ORDER_STATUSES rather than restating it, so a new order status becomes
 * filterable without a second edit here.
 */
export const VENUE_ORDER_STATUS_FILTERS = [
  ...VENUE_ORDER_STATUSES,
  "all",
] as const;

/** One of {@link VENUE_ORDER_STATUS_FILTERS}. */
export type VenueOrderStatusFilter =
  (typeof VENUE_ORDER_STATUS_FILTERS)[number];

/** Outcome of a market venue orders read. */
export type MarketVenueOrdersResult =
  | { kind: "invalid_owner"; message: string }
  | { kind: "unknown_market"; message: string }
  | { kind: "orders"; orders: VenueOrderResponse[] };

/** Data and chain reads the venue order reads depend on, injectable in tests. */
export type VenueOrderReadDependencies = {
  readCollateralDecimals: (collateral: `0x${string}`) => Promise<number>;
  readPoolSqrtPricesX96: (
    poolIds: readonly string[],
  ) => Promise<Map<string, bigint>>;
  selectMarket: (args: {
    chainId: number;
    marketId: bigint;
  }) => Promise<MarketRow | null>;
  selectOpenOrders: (args: {
    chainId: number;
    poolIds: readonly string[];
  }) => Promise<VenueOrderRow[]>;
  selectOwnerOrders: (args: {
    chainId: number;
    marketId: bigint;
    owner: string;
    statuses: VenueOrderStatusResponse[] | null;
  }) => Promise<{ order: VenueOrderRow; pool: VenuePoolRow }[]>;
  selectVenuePools: (args: {
    chainId: number;
    marketId: bigint;
  }) => Promise<VenuePoolRow[]>;
};

/**
 * Assembles the bounded-venue order book for one market, or null when the
 * market id is malformed or the market is unknown (the route answers 404,
 * matching getMarketById). A market without indexed venue pools — not yet
 * graduated — returns the book with both ladders omitted.
 */
export async function getMarketOrderBook(
  { chainId, marketId }: { chainId: number; marketId: string },
  dependencies: VenueOrderReadDependencies = defaultDependencies,
): Promise<MarketOrderBookResponse | null> {
  const parsedMarketId = parseMarketId(marketId);

  if (parsedMarketId === null) {
    return null;
  }

  const market = await dependencies.selectMarket({
    chainId,
    marketId: parsedMarketId,
  });

  if (!market) {
    return null;
  }

  const response: MarketOrderBookResponse = {
    chainId,
    marketId: parsedMarketId.toString(),
  };
  const pools = await dependencies.selectVenuePools({
    chainId,
    marketId: parsedMarketId,
  });

  if (pools.length === 0) {
    return response;
  }

  const poolIds = pools.map((pool) => pool.poolId);
  const [collateralDecimals, orders, sqrtPrices] = await Promise.all([
    dependencies.readCollateralDecimals(market.collateral as `0x${string}`),
    dependencies.selectOpenOrders({ chainId, poolIds }),
    dependencies.readPoolSqrtPricesX96(poolIds),
  ]);

  for (const pool of pools) {
    const book = buildVenueOrderBookPool({
      collateralDecimals,
      orders: orders.filter((order) => order.poolId === pool.poolId),
      pool,
      sqrtPriceX96: sqrtPrices.get(pool.poolId),
    });

    if (pool.side === "yes") {
      response.yes = book;
    } else {
      response.no = book;
    }
  }

  return response;
}

/**
 * Lists one wallet's indexed maker orders on a market's venue pools, newest
 * first. Defaults to open orders; a status filter narrows to one lifecycle
 * state and "all" returns everything. Unknown and malformed market ids report
 * unknown_market so the route can answer 404.
 */
export async function getMarketVenueOrders(
  {
    chainId,
    marketId,
    owner,
    status,
  }: {
    chainId: number;
    marketId: string;
    owner: string;
    status?: VenueOrderStatusFilter;
  },
  dependencies: VenueOrderReadDependencies = defaultDependencies,
): Promise<MarketVenueOrdersResult> {
  const normalizedOwner = owner.toLowerCase();

  if (!/^0x[0-9a-f]{40}$/.test(normalizedOwner)) {
    return {
      kind: "invalid_owner",
      message: `Invalid owner address: ${owner}`,
    };
  }

  const parsedMarketId = parseMarketId(marketId);

  if (parsedMarketId === null) {
    return { kind: "unknown_market", message: "Market not found" };
  }

  const market = await dependencies.selectMarket({
    chainId,
    marketId: parsedMarketId,
  });

  if (!market) {
    return { kind: "unknown_market", message: "Market not found" };
  }

  const rows = await dependencies.selectOwnerOrders({
    chainId,
    marketId: parsedMarketId,
    owner: normalizedOwner,
    statuses: status === "all" ? null : [status ?? "open"],
  });

  if (rows.length === 0) {
    return { kind: "orders", orders: [] };
  }

  const collateralDecimals = await dependencies.readCollateralDecimals(
    market.collateral as `0x${string}`,
  );

  return {
    kind: "orders",
    orders: rows.map(({ order, pool }) =>
      serializeVenueOrder({ collateralDecimals, order, pool }),
    ),
  };
}

function parseMarketId(marketId: string): bigint | null {
  try {
    return BigInt(marketId);
  } catch {
    return null;
  }
}

const defaultDependencies: VenueOrderReadDependencies = {
  readCollateralDecimals,
  readPoolSqrtPricesX96,
  selectMarket: selectLiveMarketRow,
  selectOpenOrders: async ({ chainId, poolIds }) =>
    db
      .select()
      .from(schema.venueOrders)
      .where(
        and(
          eq(schema.venueOrders.chainId, chainId),
          inArray(schema.venueOrders.poolId, [...poolIds]),
          eq(schema.venueOrders.status, "open"),
        ),
      ),
  selectOwnerOrders: async ({ chainId, marketId, owner, statuses }) => {
    const conditions = [
      eq(schema.venueOrders.chainId, chainId),
      eq(schema.venueOrders.owner, owner),
      eq(schema.venuePools.marketId, marketId),
      ...(statuses ? [inArray(schema.venueOrders.status, statuses)] : []),
    ];

    return db
      .select({ order: schema.venueOrders, pool: schema.venuePools })
      .from(schema.venueOrders)
      .innerJoin(
        schema.venuePools,
        and(
          eq(schema.venuePools.chainId, schema.venueOrders.chainId),
          eq(schema.venuePools.poolId, schema.venueOrders.poolId),
        ),
      )
      .where(and(...conditions))
      .orderBy(
        desc(schema.venueOrders.createdBlockNumber),
        desc(schema.venueOrders.createdLogIndex),
      );
  },
  selectVenuePools: async ({ chainId, marketId }) =>
    db
      .select()
      .from(schema.venuePools)
      .where(
        and(
          eq(schema.venuePools.chainId, chainId),
          eq(schema.venuePools.marketId, marketId),
        ),
      ),
};
