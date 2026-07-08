import type {
  MarketOrderBook,
  VenueOrderBookLevel,
  VenueOrderBookPool,
} from "@popcharts/api-client/models";

/** One resting price level of the depth ladder, in display units. */
export type OrderBookLevelView = {
  /** Running share total from the best level down to this one. */
  cumulativeShares: number;
  orderCount: number;
  priceCents: number;
  sizeShares: number;
};

/**
 * One outcome pool's ladder in display units. Both arrays stay best-first
 * (asks lowest price first, bids highest first), matching the API order.
 */
export type OrderBookPoolView = {
  asks: OrderBookLevelView[];
  bids: OrderBookLevelView[];
  /** Pool price in cents, or null while the pool is uninitialized. */
  marketPriceCents: number | null;
  /** Largest cumulative share total on either half, for depth-bar scaling. */
  maxCumulativeShares: number;
  /** Best ask minus best bid in cents, or null when either half is empty. */
  spreadCents: number | null;
};

const CENTS_PER_WAD = 1e16;
const SHARES_PER_WAD = 1e18;

/**
 * Converts one outcome pool's raw WAD order book into display units with the
 * cumulative depth totals the ladder needs.
 */
export function buildOrderBookPoolView(pool: VenueOrderBookPool): OrderBookPoolView {
  const asks = accumulateLevels(pool.asks);
  const bids = accumulateLevels(pool.bids);
  const bestAsk = asks[0];
  const bestBid = bids[0];

  return {
    asks,
    bids,
    marketPriceCents:
      pool.marketPriceWad === undefined
        ? null
        : Number(pool.marketPriceWad) / CENTS_PER_WAD,
    maxCumulativeShares: Math.max(
      asks.at(-1)?.cumulativeShares ?? 0,
      bids.at(-1)?.cumulativeShares ?? 0
    ),
    spreadCents: bestAsk && bestBid ? bestAsk.priceCents - bestBid.priceCents : null,
  };
}

/**
 * True when the indexer has seen at least one venue pool for the market. A
 * graduated market whose handoff is not indexed yet returns the book with
 * both pools omitted.
 */
export function hasIndexedPools(book: MarketOrderBook) {
  return book.yes !== undefined || book.no !== undefined;
}

function accumulateLevels(levels: VenueOrderBookLevel[]): OrderBookLevelView[] {
  let cumulativeShares = 0;

  return levels.map((level) => {
    const sizeShares = Number(level.sizeWad) / SHARES_PER_WAD;
    cumulativeShares += sizeShares;

    return {
      cumulativeShares,
      orderCount: level.orderCount,
      priceCents: Number(level.priceWad) / CENTS_PER_WAD,
      sizeShares,
    };
  });
}
