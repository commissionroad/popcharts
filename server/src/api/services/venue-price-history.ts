import {
  COMPLETE_SET_PRICE_POLICY,
  clampDisplayPriceWad,
  tickToDisplayPriceWad,
  WAD,
} from "@popcharts/protocol";

import { and, asc, db, desc, eq, inArray, schema } from "src/db/client";
import { displayPriceWadToCents } from "src/shared/venue-prices";

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

/**
 * One folded venue sample. Formerly the deleted venue-only endpoint's wire
 * shape; now internal to the unified price-history read, which maps it onto
 * the phase-blind PricePoint (repo ADR 0025 P4).
 */
export type VenuePricePointResponse = {
  at: string;
  noPriceCents: number;
  yesPriceCents: number;
};

/** Drizzle select shape of a pool_price_ticks row. */
export type PoolPriceTickRow = typeof schema.poolPriceTicks.$inferSelect;

/** A tick observation paired with the pool it moved. */
export type PoolPriceTickWithPool = {
  readonly pool: VenuePoolRow;
  readonly tick: PoolPriceTickRow;
};

// Moved to the shared venue-price module when the indexer's priced-tick emit
// became a second consumer (repo ADR 0025); re-exported so this service's
// call sites and tests keep their import path.
export { displayPriceWadToCents };

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
      // Chain order: block number then log index. NOT blockTimestamp — on a
      // subsecond chain two blocks routinely share a timestamp while logIndex
      // resets per block, which would interleave their swaps out of order and
      // corrupt the forward-fill (Codex P3 review finding). The timestamp only
      // labels the resulting point.
      .orderBy(
        asc(schema.poolPriceTicks.blockNumber),
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
