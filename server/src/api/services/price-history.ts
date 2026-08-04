import { contractSideToMarketSide, wadToNumber } from "@popcharts/protocol";
import {
  createOpeningState,
  marginalPriceCents,
  stateAfterBuy,
} from "@popcharts/protocol/virtual-lmsr";

import type {
  MarketPriceHistoryResponse,
  PricePointResponse,
} from "src/api/models/markets";
import { and, asc, db, eq, schema } from "src/db/client";

import type { MarketRow } from "./markets";
import {
  foldVenuePricePoints,
  venueOpeningPoint,
  venuePriceHistoryReads,
  type VenuePriceHistoryDependencies,
} from "./venue-price-history";

/**
 * One read for a market's whole price life (repo ADR 0025): the virtual
 * LMSR's implied probabilities over the receipt book, then — for a graduated
 * market — the bounded venue's own prices, joined at the handoff by the
 * synthesized opening point (the pools are initialized at the pregrad book's
 * closing price, so the line is continuous by construction).
 *
 * Every point carries both outcomes in fractional cents. Pre-graduation the
 * pair is complementary by construction; post-graduation the two pools price
 * independently and only approach a complete set as arbitrage closes the gap.
 * The point shape is identical across the seam — a consumer cannot tell the
 * phases apart, which is the ADR's goal — and `graduatedAt` is carried as a
 * pure annotation for the chart's rule.
 *
 * This subsumes both the app-side LMSR replay (deleted in P4) and the
 * venue-only endpoint; the LMSR replay itself runs through the same protocol
 * functions the live tick emit uses, so a replayed point equals a pushed one.
 */

/**
 * Ceiling on returned samples, kept at the app replay's historical cap. The
 * ADR's "one downsample cap": each phase is thinned within one shared budget,
 * always keeping the opening, the handoff, and the latest samples.
 */
const MAX_PRICE_HISTORY_POINTS = 256;

/**
 * Ceiling on receipts loaded and replayed per request. The replay is linear
 * in receipt count with no way to start mid-stream (state is cumulative), so
 * an unbounded read would let one runaway market dictate per-request DB and
 * CPU cost (Codex P3 review finding). Past the cap the pregrad half degrades
 * to its exact endpoints — the opening state and the market row's locked
 * cumulative state — which keeps the handoff continuous while bounding work.
 */
const REPLAY_RECEIPT_CAP = 5_000;

/** Drizzle select shape of a receipt_placed_events row. */
type ReceiptPlacedRow = typeof schema.receiptPlacedEvents.$inferSelect;

/** Reads the unified history depends on: the venue set plus the receipt list. */
export type PriceHistoryDependencies = VenuePriceHistoryDependencies & {
  selectReceiptEvents: (args: {
    chainId: number;
    limit: number;
    marketId: bigint;
  }) => Promise<ReceiptPlacedRow[]>;
};

/**
 * Replays the market's receipts through the shared virtual LMSR to recover
 * the pre-graduation price path: the opening price at market creation, then
 * the implied YES price after each receipt, in on-chain sequence order. NO is
 * the exact complement — one LMSR state prices both sides.
 */
export function pregradPricePoints(
  market: Pick<
    MarketRow,
    "createdBlockTimestamp" | "liquidityParameter" | "openingProbabilityWad"
  >,
  receipts: readonly ReceiptPlacedRow[],
): PricePointResponse[] {
  let state = createOpeningState({
    b: wadToNumber(market.liquidityParameter),
    // Full-precision fractional cents, NOT wadToCents: that helper rounds to
    // whole cents and clamps to [1, 99], while the venue handoff derives from
    // the unrounded WAD probability — a fractional opening (say 55.5%) would
    // otherwise replay from 56% and hand off at 55.5%, a false jump at the
    // seam (Codex P3 review finding).
    openingProbability: wadToNumber(market.openingProbabilityWad) * 100,
  });
  const toPoint = (at: Date): PricePointResponse => {
    const yesCents = marginalPriceCents(state, "yes");

    return { at: at.toISOString(), noCents: 100 - yesCents, yesCents };
  };

  const points = [toPoint(market.createdBlockTimestamp)];

  for (const receipt of receipts) {
    state = stateAfterBuy({
      shares: wadToNumber(receipt.shares),
      side: contractSideToMarketSide(receipt.side),
      state,
    });
    points.push(toPoint(receipt.blockTimestamp));
  }

  return points;
}

/**
 * Thins a history to at most `maxPoints` by even stride, always keeping the
 * first and latest samples. Applied once over the unified path so the two
 * halves are thinned together, not per-phase.
 */
export function downsamplePricePoints(
  points: PricePointResponse[],
  maxPoints: number,
): PricePointResponse[] {
  if (points.length <= maxPoints) {
    return points;
  }

  const stride = (points.length - 1) / (maxPoints - 1);

  return Array.from(
    { length: maxPoints },
    (_, index) => points[Math.round(index * stride)]!,
  );
}

/**
 * Assembles the whole-life price history, or null when the market id is
 * malformed or unknown (the route answers 404, matching getMarketById).
 * A market that has not graduated simply has no venue half and no
 * `graduatedAt` — the pregrad path alone is a complete answer.
 */
export async function getMarketPriceHistory(
  { chainId, marketId }: { chainId: number; marketId: string },
  dependencies: PriceHistoryDependencies = defaultDependencies,
): Promise<MarketPriceHistoryResponse | null> {
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

  const [receipts, graduatedAt, pools] = await Promise.all([
    dependencies.selectReceiptEvents({
      chainId,
      limit: REPLAY_RECEIPT_CAP + 1,
      marketId: parsedMarketId,
    }),
    dependencies.selectGraduatedAt({ chainId, marketId: parsedMarketId }),
    dependencies.selectVenuePools({ chainId, marketId: parsedMarketId }),
  ]);

  const pregradPoints =
    receipts.length > REPLAY_RECEIPT_CAP
      ? pregradEndpoints(market, graduatedAt)
      : pregradPricePoints(market, receipts);
  const response: MarketPriceHistoryResponse = {
    chainId,
    marketId: parsedMarketId.toString(),
    points: pregradPoints,
  };

  if (graduatedAt !== null) {
    response.graduatedAt = graduatedAt.toISOString();
  }

  if (graduatedAt !== null && pools.length > 0) {
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

    const venuePoints = foldVenuePricePoints({
      collateralDecimals,
      opening: venueOpeningPoint(market, graduatedAt),
      ticks,
    });

    const venueHalf = venuePoints.map((point) => ({
      at: point.at,
      noCents: point.noPriceCents,
      yesCents: point.yesPriceCents,
    }));

    // Thin each phase within one shared budget instead of thinning the
    // concat: a single global pass keeps only the overall first and last
    // samples, so a long history could drop the synthesized handoff and draw
    // pregrad movement straight into a later venue trade (Codex P3 review
    // finding). Per-phase thinning keeps each half's endpoints — opening,
    // last pregrad point, handoff, and newest venue point all survive.
    const total = pregradPoints.length + venueHalf.length;
    if (total <= MAX_PRICE_HISTORY_POINTS) {
      response.points = pregradPoints.concat(venueHalf);
    } else {
      const pregradBudget = Math.min(
        Math.max(
          2,
          Math.round((MAX_PRICE_HISTORY_POINTS * pregradPoints.length) / total),
        ),
        MAX_PRICE_HISTORY_POINTS - 2,
      );

      response.points = downsamplePricePoints(
        pregradPoints,
        pregradBudget,
      ).concat(
        downsamplePricePoints(
          venueHalf,
          MAX_PRICE_HISTORY_POINTS - pregradBudget,
        ),
      );
    }

    return response;
  }

  response.points = downsamplePricePoints(
    response.points,
    MAX_PRICE_HISTORY_POINTS,
  );

  return response;
}

/**
 * The pregrad path reduced to its exact endpoints, for histories too long to
 * replay per request: the opening state at creation, and the market row's
 * locked cumulative state — the same numbers a full replay would start and
 * end at, so the handoff stays continuous. The closing timestamp is the
 * graduation when there is one (receipts stop there), otherwise the row's
 * last update, which the receipt handler bumps on every trade.
 */
function pregradEndpoints(
  market: Pick<
    MarketRow,
    | "createdBlockTimestamp"
    | "liquidityParameter"
    | "noShares"
    | "openingProbabilityWad"
    | "updatedAt"
    | "yesShares"
  >,
  graduatedAt: Date | null,
): PricePointResponse[] {
  const opening = createOpeningState({
    b: wadToNumber(market.liquidityParameter),
    openingProbability: wadToNumber(market.openingProbabilityWad) * 100,
  });
  const closing = stateAfterBuy({
    shares: wadToNumber(market.yesShares),
    side: "yes",
    state: stateAfterBuy({
      shares: wadToNumber(market.noShares),
      side: "no",
      state: opening,
    }),
  });
  const toPoint = (at: Date, state: typeof opening): PricePointResponse => {
    const yesCents = marginalPriceCents(state, "yes");

    return { at: at.toISOString(), noCents: 100 - yesCents, yesCents };
  };

  return [
    toPoint(market.createdBlockTimestamp, opening),
    toPoint(graduatedAt ?? market.updatedAt, closing),
  ];
}

function parseMarketId(marketId: string): bigint | null {
  try {
    return BigInt(marketId);
  } catch {
    return null;
  }
}

const defaultDependencies: PriceHistoryDependencies = {
  ...venuePriceHistoryReads,
  selectReceiptEvents: async ({ chainId, limit, marketId }) =>
    db
      .select()
      .from(schema.receiptPlacedEvents)
      .where(
        and(
          eq(schema.receiptPlacedEvents.chainId, chainId),
          eq(schema.receiptPlacedEvents.marketId, marketId),
        ),
      )
      .orderBy(asc(schema.receiptPlacedEvents.sequence))
      .limit(limit),
};
