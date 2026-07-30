import {
  COMPLETE_SET_PRICE_POLICY,
  clampDisplayPriceWad,
  tickToDisplayPriceWad,
  WAD,
} from "@popcharts/protocol";

import type {
  MarketVenuePriceHistoryResponse,
  VenuePricePointResponse,
} from "src/api/models/markets";
import { and, asc, db, desc, eq, inArray, schema } from "src/db/client";

import { selectLiveMarketRow, type MarketRow } from "./markets";
import {
  closingYesDisplayPriceWad,
  readCollateralDecimals,
} from "./postgrad-venue";
import type { VenuePoolRow } from "./venue-orderbook";

/**
 * Read API over the price history of a graduated market's bounded venue.
 *
 * Taker swaps leave no other database trace, so `pool_price_ticks` — the raw
 * post-swap tick the BoundedPredictionHook observes — is the only record that
 * the venue's prices moved. This service turns that stream into the chart's
 * shape: whole-cent YES and NO prices at every sample.
 *
 * Conversion lives here rather than in the app for the same reason the order
 * book's does: it needs the collateral's decimals, which is a chain read.
 *
 * The only chain read is that memoized decimals lookup; everything else is
 * deterministic off the indexed rows and the market's own locked LMSR state.
 */

/** Ceiling on returned samples, matching the app's receipt-path downsampling. */
const MAX_VENUE_PRICE_POINTS = 240;

/** Drizzle select shape of a pool_price_ticks row. */
export type PoolPriceTickRow = typeof schema.poolPriceTicks.$inferSelect;

/** A tick observation paired with the pool it moved. */
export type PoolPriceTickWithPool = {
  readonly pool: VenuePoolRow;
  readonly tick: PoolPriceTickRow;
};

/**
 * Converts a WAD display price (collateral per outcome token) into the whole
 * cents the chart plots. A token pays one collateral when its outcome wins, so
 * its price *is* the implied probability and 1 WAD is 100 cents. Rounded to
 * whole cents because the chart's y axis is a percentage; the unrounded WAD
 * stays available on the order book for anyone pricing a trade.
 */
export function displayPriceWadToCents(displayPriceWad: bigint): number {
  return Math.round((Number(displayPriceWad) / Number(WAD)) * 100);
}

/**
 * The price each pool opens at: the pregrad book's closing YES probability,
 * with NO taking its complement, both clamped into the ADR 0009 display band.
 *
 * This mirrors `wirePostgradMarketVenue`, which initializes the pools from the
 * very same closing price — so this is the actual opening price by
 * construction, not an estimate of it. Deriving it here rather than indexing
 * it keeps pool initialization (an off-chain, idempotent wiring step that
 * emits no swap) out of the indexer, and makes the chart continuous across
 * graduation: the venue opens exactly where the LMSR closed.
 */
export function venueOpeningPoint(
  market: Pick<
    MarketRow,
    "liquidityParameter" | "noShares" | "openingProbabilityWad" | "yesShares"
  >,
  at: Date,
): VenuePricePointResponse {
  const yesDisplayPriceWad = closingYesDisplayPriceWad({
    liquidityParameter: market.liquidityParameter,
    noShares: market.noShares,
    openingProbabilityWad: market.openingProbabilityWad,
    yesShares: market.yesShares,
  });

  return {
    at: at.toISOString(),
    noPriceCents: displayPriceWadToCents(
      clampDisplayPriceWad(WAD - yesDisplayPriceWad),
    ),
    yesPriceCents: displayPriceWadToCents(yesDisplayPriceWad),
  };
}

/**
 * Folds tick observations into chart samples, carrying the untouched side
 * forward at each step.
 *
 * A swap moves one pool, so a raw tick row prices one outcome and says nothing
 * about the other. Emitting only the moved side would leave each sample half
 * empty and force every consumer to reconstruct the same running state. The
 * forward fill is not interpolation: the other pool genuinely still stands at
 * its last observed price, because nothing has traded it since.
 *
 * `opening` seeds both sides so the first swap on one pool still yields a
 * complete sample. Ticks must arrive in chain order — the caller sorts by
 * (blockTimestamp, logIndex), which is total within a chain.
 */
export function foldVenuePricePoints({
  collateralDecimals,
  opening,
  ticks,
}: {
  readonly collateralDecimals: number;
  readonly opening: VenuePricePointResponse;
  readonly ticks: readonly PoolPriceTickWithPool[];
}): VenuePricePointResponse[] {
  const points: VenuePricePointResponse[] = [opening];
  let noPriceCents = opening.noPriceCents;
  let yesPriceCents = opening.yesPriceCents;

  for (const { pool, tick } of ticks) {
    const cents = displayPriceWadToCents(
      tickToDisplayPriceWad({
        collateralDecimals,
        outcomeDecimals: COMPLETE_SET_PRICE_POLICY.outcomeDecimals,
        outcomeIsCurrency0: pool.outcomeIsCurrency0,
        tick: tick.tick,
      }),
    );

    if (pool.side === "yes") {
      yesPriceCents = cents;
    } else {
      noPriceCents = cents;
    }

    points.push({
      at: tick.blockTimestamp.toISOString(),
      noPriceCents,
      yesPriceCents,
    });
  }

  return points;
}

/**
 * Thins a history to at most `maxPoints` by even stride, always keeping the
 * opening and latest samples. Mirrors the app's receipt-path downsampling so
 * both halves of the chart are thinned the same way.
 */
export function downsampleVenuePricePoints(
  points: VenuePricePointResponse[],
  maxPoints: number,
): VenuePricePointResponse[] {
  if (points.length <= maxPoints) {
    return points;
  }

  const stride = (points.length - 1) / (maxPoints - 1);

  return Array.from(
    { length: maxPoints },
    (_, index) => points[Math.round(index * stride)]!,
  );
}

/** Data and chain reads the venue price history depends on, injectable in tests. */
export type VenuePriceHistoryDependencies = {
  readCollateralDecimals: (collateral: `0x${string}`) => Promise<number>;
  selectGraduatedAt: (args: {
    chainId: number;
    marketId: bigint;
  }) => Promise<Date | null>;
  selectMarket: (args: {
    chainId: number;
    marketId: bigint;
  }) => Promise<MarketRow | null>;
  selectPoolPriceTicks: (args: {
    chainId: number;
    poolIds: readonly string[];
  }) => Promise<PoolPriceTickRow[]>;
  selectVenuePools: (args: {
    chainId: number;
    marketId: bigint;
  }) => Promise<VenuePoolRow[]>;
};

/**
 * Assembles a market's post-graduation price history, or null when the market
 * id is malformed or unknown (the route answers 404, matching getMarketById).
 *
 * An empty `points` array is a normal answer, not a failure: a market that has
 * not graduated has no venue, and one whose pools are not indexed yet has no
 * prices to report. Both are states the market page renders every day.
 */
export async function getMarketVenuePriceHistory(
  { chainId, marketId }: { chainId: number; marketId: string },
  dependencies: VenuePriceHistoryDependencies = venuePriceHistoryReads,
): Promise<MarketVenuePriceHistoryResponse | null> {
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

  const response: MarketVenuePriceHistoryResponse = {
    chainId,
    marketId: parsedMarketId.toString(),
    points: [],
  };
  const [graduatedAt, pools] = await Promise.all([
    dependencies.selectGraduatedAt({ chainId, marketId: parsedMarketId }),
    dependencies.selectVenuePools({ chainId, marketId: parsedMarketId }),
  ]);

  // Reported as soon as the handoff is known, independently of whether any
  // price followed it: "graduated at T with no venue prices yet" is a state
  // the caller must be able to tell apart from "not graduated".
  if (graduatedAt !== null) {
    response.graduatedAt = graduatedAt.toISOString();
  }

  // Both are required to price anything: without the handoff there is no
  // opening price, and without pools there is nothing to attribute a tick to.
  if (graduatedAt === null || pools.length === 0) {
    return response;
  }

  const poolsById = new Map(pools.map((pool) => [pool.poolId, pool]));
  const [collateralDecimals, tickRows] = await Promise.all([
    dependencies.readCollateralDecimals(market.collateral as `0x${string}`),
    dependencies.selectPoolPriceTicks({
      chainId,
      poolIds: pools.map((pool) => pool.poolId),
    }),
  ]);
  const ticks = tickRows.flatMap((tick) => {
    const pool = poolsById.get(tick.poolId);

    return pool ? [{ pool, tick }] : [];
  });

  response.points = downsampleVenuePricePoints(
    foldVenuePricePoints({
      collateralDecimals,
      opening: venueOpeningPoint(market, graduatedAt),
      ticks,
    }),
    MAX_VENUE_PRICE_POINTS,
  );

  return response;
}

function parseMarketId(marketId: string): bigint | null {
  try {
    return BigInt(marketId);
  } catch {
    return null;
  }
}

/**
 * The production reads. Exported so the database-backed suite can exercise the
 * queries themselves: a route test cannot reach them, because the moment a
 * market has indexed pools this service also reads the collateral's decimals
 * off-chain, and the ordering these selectors depend on is exactly the kind of
 * thing that only fails against a real database.
 */
export const venuePriceHistoryReads: VenuePriceHistoryDependencies = {
  readCollateralDecimals,
  selectGraduatedAt: async ({ chainId, marketId }) => {
    // The latest finalize wins, matching selectPostgradInfo: a re-finalized
    // market's venue opens at the price the last handoff set.
    const rows = await db
      .select({
        blockTimestamp: schema.graduationFinalizedEvents.blockTimestamp,
      })
      .from(schema.graduationFinalizedEvents)
      .where(
        and(
          eq(schema.graduationFinalizedEvents.chainId, chainId),
          eq(schema.graduationFinalizedEvents.marketId, marketId),
        ),
      )
      .orderBy(
        desc(schema.graduationFinalizedEvents.blockNumber),
        desc(schema.graduationFinalizedEvents.logIndex),
      )
      .limit(1);

    return rows[0]?.blockTimestamp ?? null;
  },
  selectMarket: selectLiveMarketRow,
  selectPoolPriceTicks: async ({ chainId, poolIds }) =>
    db
      .select()
      .from(schema.poolPriceTicks)
      .where(
        and(
          eq(schema.poolPriceTicks.chainId, chainId),
          inArray(schema.poolPriceTicks.poolId, [...poolIds]),
        ),
      )
      // Chain order, and total within a chain: two swaps in one block are
      // separated by log index. Served by pool_price_ticks_chain_pool_time_idx.
      .orderBy(
        asc(schema.poolPriceTicks.blockTimestamp),
        asc(schema.poolPriceTicks.logIndex),
      ),
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
