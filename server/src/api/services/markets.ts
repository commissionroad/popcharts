import type {
  MarketCategory,
  MarketCreatedEventResponse,
  MarketResponse,
} from "src/api/models/markets";
import { db } from "src/db/client";
import { and, desc, eq, schema } from "src/db/client";

export async function getMarkets(chainId?: number): Promise<MarketResponse[]> {
  const rows =
    chainId === undefined
      ? await db
          .select({
            market: schema.markets,
            metadata: schema.marketMetadata,
          })
          .from(schema.markets)
          .leftJoin(
            schema.marketMetadata,
            eq(schema.markets.metadataHash, schema.marketMetadata.metadataHash),
          )
          .orderBy(desc(schema.markets.createdBlockTimestamp))
          .limit(100)
      : await db
          .select({
            market: schema.markets,
            metadata: schema.marketMetadata,
          })
          .from(schema.markets)
          .leftJoin(
            schema.marketMetadata,
            eq(schema.markets.metadataHash, schema.marketMetadata.metadataHash),
          )
          .where(eq(schema.markets.chainId, chainId))
          .orderBy(desc(schema.markets.createdBlockTimestamp))
          .limit(100);

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
    .select({
      market: schema.markets,
      metadata: schema.marketMetadata,
    })
    .from(schema.markets)
    .leftJoin(
      schema.marketMetadata,
      eq(schema.markets.metadataHash, schema.marketMetadata.metadataHash),
    )
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

function serializeMarketRow(row: {
  market: typeof schema.markets.$inferSelect;
  metadata: typeof schema.marketMetadata.$inferSelect | null;
}): MarketResponse {
  return {
    chainId: row.market.chainId,
    collateral: row.market.collateral,
    createdAt: row.market.createdAt.toISOString(),
    createdBlockNumber: row.market.createdBlockNumber.toString(),
    createdBlockTimestamp: row.market.createdBlockTimestamp.toISOString(),
    createdLogIndex: row.market.createdLogIndex,
    createdTransactionHash: row.market.createdTransactionHash,
    creator: row.market.creator,
    graduationThreshold: row.market.graduationThreshold.toString(),
    graduationTime: row.market.graduationTime.toISOString(),
    liquidityParameter: row.market.liquidityParameter.toString(),
    marketId: row.market.marketId.toString(),
    metadata: row.metadata
      ? {
          category: row.metadata.category as MarketCategory,
          createdAt: row.metadata.createdAt.toISOString(),
          description: row.metadata.description,
          metadataHash: row.metadata.metadataHash,
          question: row.metadata.question,
          resolutionCriteria: row.metadata.resolutionCriteria,
          resolutionUrl: row.metadata.resolutionUrl ?? undefined,
          version: 1 as const,
        }
      : null,
    metadataHash: row.market.metadataHash,
    noShares: row.market.noShares.toString(),
    openingProbabilityWad: row.market.openingProbabilityWad.toString(),
    receiptCount: row.market.receiptCount.toString(),
    resolutionTime: row.market.resolutionTime.toISOString(),
    status: row.market.status,
    totalEscrowed: row.market.totalEscrowed.toString(),
    updatedAt: row.market.updatedAt.toISOString(),
    yesShares: row.market.yesShares.toString(),
  };
}
