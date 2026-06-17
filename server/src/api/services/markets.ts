import { createPublicClient, http, parseAbi } from "viem";

import type {
  MarketCreatedEventResponse,
  MarketMetadataResponse,
  MarketMetadataWrite,
  MarketResponse,
} from "src/api/models/markets";
import { config } from "src/config";
import { db } from "src/db/client";
import { and, desc, eq, gt, schema } from "src/db/client";
import { calculateMatchedMarketCap } from "./matched-market-cap";

const MARKET_LIST_LIMIT = 200;
const LOCAL_MARKET_EXISTS_ABI = parseAbi([
  "function marketExists(uint256 marketId) view returns (bool)",
]);

export type MarketRow = typeof schema.markets.$inferSelect;
export type MarketMetadataRow = typeof schema.marketMetadata.$inferSelect;
type MarketQueryRow = {
  market: MarketRow;
  metadata: MarketMetadataRow | null;
};

let localPublicClient: ReturnType<typeof createPublicClient> | null = null;

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
    eq(schema.contracts.address, currentPregradManagerAddress()),
    eq(schema.contracts.chainId, config.chainId),
    chainId === undefined ? undefined : eq(schema.markets.chainId, chainId),
    sinceDate ? gt(schema.markets.createdBlockTimestamp, sinceDate) : undefined,
  ].filter(isDefined);

  const rows = await db
    .select({
      market: schema.markets,
      metadata: schema.marketMetadata,
    })
    .from(schema.markets)
    .innerJoin(schema.contracts, marketContractJoinCondition())
    .leftJoin(schema.marketMetadata, marketMetadataJoinCondition())
    .where(and(...conditions))
    .orderBy(desc(schema.markets.createdBlockTimestamp))
    .limit(MARKET_LIST_LIMIT);
  const liveRows = await filterLiveLocalMarketRows(rows);

  return liveRows.map(({ market, metadata }) =>
    serializeMarketRow(market, metadata, calculateMatchedMarketCap(market)),
  );
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
    .innerJoin(schema.contracts, marketContractJoinCondition())
    .leftJoin(schema.marketMetadata, marketMetadataJoinCondition())
    .where(
      and(
        eq(schema.contracts.address, currentPregradManagerAddress()),
        eq(schema.contracts.chainId, config.chainId),
        eq(schema.markets.chainId, chainId),
        eq(schema.markets.marketId, parsedMarketId),
      ),
    )
    .limit(1);
  const row = rows[0];

  if (!row || !(await isLiveLocalMarket(row.market.marketId))) {
    return null;
  }

  return serializeMarketRow(
    row.market,
    row.metadata,
    calculateMatchedMarketCap(row.market),
  );
}

export async function upsertMarketMetadata(
  chainId: number,
  metadata: MarketMetadataWrite,
): Promise<MarketMetadataResponse | null> {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return null;
  }

  const values = {
    category: metadata.category,
    chainId,
    description: metadata.description,
    metadataCreatedAt: metadata.createdAt,
    metadataHash: metadata.metadataHash,
    question: metadata.question,
    resolutionCriteria: metadata.resolutionCriteria,
    resolutionUrl: metadata.resolutionUrl ?? null,
    updatedAt: new Date(),
  };
  const rows = await db
    .insert(schema.marketMetadata)
    .values(values)
    .onConflictDoUpdate({
      target: [
        schema.marketMetadata.chainId,
        schema.marketMetadata.metadataHash,
      ],
      set: values,
    })
    .returning();

  return rows[0] ? serializeMarketMetadataRow(rows[0]) : null;
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
    .select({ event: schema.marketCreatedEvents })
    .from(schema.marketCreatedEvents)
    .innerJoin(schema.contracts, marketCreatedEventContractJoinCondition())
    .where(
      and(
        eq(schema.contracts.address, currentPregradManagerAddress()),
        eq(schema.contracts.chainId, config.chainId),
        eq(schema.marketCreatedEvents.chainId, chainId),
        eq(schema.marketCreatedEvents.marketId, parsedMarketId),
      ),
    )
    .orderBy(desc(schema.marketCreatedEvents.blockNumber));

  if (!(await isLiveLocalMarket(parsedMarketId))) {
    return [];
  }

  return rows.map(({ event }) => ({
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

export function serializeMarketRow(
  market: MarketRow,
  metadata: MarketMetadataRow | null,
  matchedMarketCap: bigint,
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
    matchedMarketCap: matchedMarketCap.toString(),
    ...(metadata ? { metadata: serializeMarketMetadataRow(metadata) } : {}),
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

function serializeMarketMetadataRow(
  metadata: MarketMetadataRow,
): MarketMetadataResponse {
  return {
    category: metadata.category,
    chainId: metadata.chainId,
    createdAt: metadata.createdAt.toISOString(),
    description: metadata.description,
    metadataCreatedAt: metadata.metadataCreatedAt,
    metadataHash: metadata.metadataHash,
    question: metadata.question,
    resolutionCriteria: metadata.resolutionCriteria,
    ...(metadata.resolutionUrl
      ? { resolutionUrl: metadata.resolutionUrl }
      : {}),
    updatedAt: metadata.updatedAt.toISOString(),
  };
}

function marketMetadataJoinCondition() {
  return and(
    eq(schema.marketMetadata.chainId, schema.markets.chainId),
    eq(schema.marketMetadata.metadataHash, schema.markets.metadataHash),
  );
}

function marketContractJoinCondition() {
  return and(
    eq(schema.contracts.id, schema.markets.contractId),
    eq(schema.contracts.chainId, schema.markets.chainId),
  );
}

function marketCreatedEventContractJoinCondition() {
  return and(
    eq(schema.contracts.id, schema.marketCreatedEvents.contractId),
    eq(schema.contracts.chainId, schema.marketCreatedEvents.chainId),
  );
}

function currentPregradManagerAddress() {
  return config.contracts.pregradManager.toLowerCase();
}

async function filterLiveLocalMarketRows(rows: MarketQueryRow[]) {
  if (config.name !== "local") {
    return rows;
  }

  const marketLiveness = await Promise.all(
    rows.map(async ({ market }) => isLiveLocalMarket(market.marketId)),
  );

  return rows.filter((_, index) => marketLiveness[index]);
}

async function isLiveLocalMarket(marketId: bigint) {
  if (config.name !== "local") {
    return true;
  }

  try {
    return await getLocalPublicClient().readContract({
      abi: LOCAL_MARKET_EXISTS_ABI,
      address: config.contracts.pregradManager,
      functionName: "marketExists",
      args: [marketId],
    });
  } catch (error) {
    console.warn(
      `[Markets API] Could not verify local market ${marketId.toString()}:`,
      error,
    );
    return false;
  }
}

function getLocalPublicClient() {
  localPublicClient ??= createPublicClient({
    chain: config.chain,
    transport: http(config.rpcHttpUrl),
  });

  return localPublicClient;
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
