import type {
  MarketCreatedEventResponse,
  MarketResponse,
} from "src/api/models/markets";
import { db } from "src/db/client";
import { and, desc, eq, gt, schema } from "src/db/client";

const MARKET_LIST_LIMIT = 200;

export async function getMarkets({
  chainId,
  since,
}: {
  chainId?: number;
  since?: string;
}): Promise<MarketResponse[] | null> {
  const sinceDate = parseSinceTimestamp(since);
  if (since && !sinceDate) {
    return null;
  }

  const conditions = [
    chainId === undefined ? undefined : eq(schema.markets.chainId, chainId),
    sinceDate ? gt(schema.markets.createdBlockTimestamp, sinceDate) : undefined,
  ].filter(isDefined);

  const rows =
    conditions.length === 0
      ? await db
          .select()
          .from(schema.markets)
          .orderBy(desc(schema.markets.createdBlockTimestamp))
          .limit(MARKET_LIST_LIMIT)
      : await db
          .select()
          .from(schema.markets)
          .where(and(...conditions))
          .orderBy(desc(schema.markets.createdBlockTimestamp))
          .limit(MARKET_LIST_LIMIT);

  return rows.map(serializeMarketRow);
}

export async function getMarketById(
  chainId: number,
  marketId: string,
): Promise<MarketResponse | null> {
  let parsedMarketId: bigint;

  try {
    parsedMarketId = BigInt(marketId);
  } catch {
    return null;
  }

  const rows = await db
    .select()
    .from(schema.markets)
    .where(
      and(
        eq(schema.markets.chainId, chainId),
        eq(schema.markets.marketId, parsedMarketId),
      ),
    )
    .limit(1);

  return rows[0] ? serializeMarketRow(rows[0]) : null;
}

export async function getMarketCreatedEvents(
  chainId: number,
  marketId: string,
): Promise<MarketCreatedEventResponse[]> {
  let parsedMarketId: bigint;

  try {
    parsedMarketId = BigInt(marketId);
  } catch {
    return [];
  }

  const rows = await db
    .select()
    .from(schema.marketCreatedEvents)
    .where(
      and(
        eq(schema.marketCreatedEvents.chainId, chainId),
        eq(schema.marketCreatedEvents.marketId, parsedMarketId),
      ),
    )
    .orderBy(desc(schema.marketCreatedEvents.blockNumber));

  return rows.map((event) => ({
    blockNumber: event.blockNumber.toString(),
    blockTimestamp: event.blockTimestamp.toISOString(),
    chainId: event.chainId,
    collateral: event.collateral,
    creator: event.creator,
    graduationThreshold: event.graduationThreshold.toString(),
    graduationTime: event.graduationTime.toISOString(),
    graduationTimeUnix: event.graduationTimeUnix.toString(),
    liquidityParameter: event.liquidityParameter.toString(),
    logIndex: event.logIndex,
    marketId: event.marketId.toString(),
    metadataHash: event.metadataHash,
    openingProbabilityWad: event.openingProbabilityWad.toString(),
    resolutionTime: event.resolutionTime.toISOString(),
    resolutionTimeUnix: event.resolutionTimeUnix.toString(),
    transactionHash: event.transactionHash,
  }));
}

function serializeMarketRow(
  market: typeof schema.markets.$inferSelect,
): MarketResponse {
  return {
    chainId: market.chainId,
    collateral: market.collateral,
    createdAt: market.createdAt.toISOString(),
    createdBlockNumber: market.createdBlockNumber.toString(),
    createdBlockTimestamp: market.createdBlockTimestamp.toISOString(),
    createdLogIndex: market.createdLogIndex,
    createdTransactionHash: market.createdTransactionHash,
    creator: market.creator,
    graduationThreshold: market.graduationThreshold.toString(),
    graduationTime: market.graduationTime.toISOString(),
    liquidityParameter: market.liquidityParameter.toString(),
    marketId: market.marketId.toString(),
    metadataHash: market.metadataHash,
    noShares: market.noShares.toString(),
    openingProbabilityWad: market.openingProbabilityWad.toString(),
    receiptCount: market.receiptCount.toString(),
    resolutionTime: market.resolutionTime.toISOString(),
    status: market.status,
    totalEscrowed: market.totalEscrowed.toString(),
    updatedAt: market.updatedAt.toISOString(),
    yesShares: market.yesShares.toString(),
  };
}

export function parseSinceTimestamp(value?: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
