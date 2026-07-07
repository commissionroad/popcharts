import { parseAbi } from "viem";

import type {
  MarketAiReviewResponse,
  MarketCreatedEventResponse,
  MarketMetadataResponse,
  MarketMetadataWrite,
  MarketResponse,
  ReceiptPlacedEventResponse,
} from "src/api/models/markets";
import {
  createReadOnlyClient,
  type BlockchainClient,
} from "src/blockchain/client";
import { config } from "src/config";
import { db } from "src/db/client";
import { and, asc, desc, eq, gt, inArray, schema } from "src/db/client";
import { calculateMatchedMarketCap } from "./matched-market-cap";

const MARKET_LIST_LIMIT = 200;
const LOCAL_MARKET_EXISTS_ABI = parseAbi([
  "function marketExists(uint256 marketId) view returns (bool)",
]);

/** Drizzle select shape of a markets row, shared by the market services. */
export type MarketRow = typeof schema.markets.$inferSelect;
/** Drizzle select shape of a market_ai_reviews row. */
export type MarketAiReviewRow = typeof schema.marketAiReviews.$inferSelect;
/** Drizzle select shape of a market_metadata row. */
export type MarketMetadataRow = typeof schema.marketMetadata.$inferSelect;
type MarketQueryRow = {
  market: MarketRow;
  metadata: MarketMetadataRow | null;
};

let localPublicClient: BlockchainClient | null = null;

/**
 * Lists markets for the currently configured PregradManager, newest first,
 * each decorated with metadata, matched market cap, and its latest AI review.
 * Returns null when the since filter is unparseable so the route can answer
 * 400 instead of silently ignoring the filter. On the local network, markets
 * that no longer exist on-chain (e.g. after a chain restart) are filtered out.
 */
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
  const reviews = await getLatestAiReviews(
    liveRows.map(({ market }) => market),
  );

  return liveRows.map(({ market, metadata }) =>
    serializeMarketRow(
      market,
      metadata,
      calculateMatchedMarketCap(market),
      reviews.get(marketReviewKey(market.chainId, market.marketId)) ?? null,
    ),
  );
}

/**
 * Fetches a single serialized market, or null when the id is malformed, the
 * market is unknown, or (locally) the market no longer exists on-chain — the
 * route treats all three uniformly as 404.
 */
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

  const reviews = await getLatestAiReviews([row.market]);

  return serializeMarketRow(
    row.market,
    row.metadata,
    calculateMatchedMarketCap(row.market),
    reviews.get(marketReviewKey(row.market.chainId, row.market.marketId)) ??
      null,
  );
}

/**
 * Idempotently stores off-chain market metadata keyed by (chainId,
 * metadataHash), replacing any previous row for the same hash so re-submitted
 * metadata always converges to the latest write. Returns null for an invalid
 * chain id.
 */
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
    resolutionSources: metadata.resolutionSources ?? [],
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

/**
 * Returns the indexed MarketCreated events for one market, newest block first.
 * Malformed ids and locally dead markets yield an empty list rather than an
 * error, matching the list-shaped response contract.
 */
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
    bypassAiResolution: event.bypassAiResolution,
    chainId: event.chainId,
    collateral: event.collateral,
    creator: event.creator,
    graduationThreshold: event.graduationThreshold.toString(),
    graduationTime: event.graduationTime.toISOString(),
    graduationTimeUnix: event.graduationTimeUnix.toString(),
    liquidityParameter: event.liquidityParameter.toString(),
    logIndex: event.logIndex,
    marketId: event.marketId.toString(),
    metadata: event.metadata,
    metadataHash: event.metadataHash,
    openingProbabilityWad: event.openingProbabilityWad.toString(),
    resolutionTime: event.resolutionTime.toISOString(),
    resolutionTimeUnix: event.resolutionTimeUnix.toString(),
    transactionHash: event.transactionHash,
  }));
}

/**
 * Returns the indexed ReceiptPlaced events for one market, oldest first by
 * on-chain sequence so callers can replay the LMSR price path in trade order.
 * Malformed ids and locally dead markets yield an empty list rather than an
 * error, matching the list-shaped response contract.
 */
export async function getMarketReceiptPlacedEvents(
  chainId: number,
  marketId: string,
): Promise<ReceiptPlacedEventResponse[]> {
  let parsedMarketId: bigint;

  try {
    parsedMarketId = BigInt(marketId);
  } catch {
    return [];
  }

  const rows = await db
    .select({ event: schema.receiptPlacedEvents })
    .from(schema.receiptPlacedEvents)
    .innerJoin(schema.contracts, receiptPlacedEventContractJoinCondition())
    .where(
      and(
        eq(schema.contracts.address, currentPregradManagerAddress()),
        eq(schema.contracts.chainId, config.chainId),
        eq(schema.receiptPlacedEvents.chainId, chainId),
        eq(schema.receiptPlacedEvents.marketId, parsedMarketId),
      ),
    )
    .orderBy(asc(schema.receiptPlacedEvents.sequence));

  if (!(await isLiveLocalMarket(parsedMarketId))) {
    return [];
  }

  return rows.map(({ event }) => serializeReceiptPlacedEventRow(event));
}

/** Drizzle select shape of a receipt_placed_events row. */
export type ReceiptPlacedEventRow =
  typeof schema.receiptPlacedEvents.$inferSelect;

/**
 * Maps a receipt event row to its API shape: bigints become decimal strings
 * and dates become ISO strings, mirroring serializeMarketRow.
 */
export function serializeReceiptPlacedEventRow(
  event: ReceiptPlacedEventRow,
): ReceiptPlacedEventResponse {
  return {
    blockNumber: event.blockNumber.toString(),
    blockTimestamp: event.blockTimestamp.toISOString(),
    chainId: event.chainId,
    cost: event.cost.toString(),
    logIndex: event.logIndex,
    marketId: event.marketId.toString(),
    owner: event.owner,
    receiptId: event.receiptId.toString(),
    sequence: event.sequence.toString(),
    shares: event.shares.toString(),
    side: event.side,
    transactionHash: event.transactionHash,
  };
}

/**
 * Single source of truth for mapping a market row (plus optional metadata and
 * latest AI review) to the public MarketResponse: bigints become decimal
 * strings, dates become ISO strings, and absent relations are omitted.
 */
export function serializeMarketRow(
  market: MarketRow,
  metadata: MarketMetadataRow | null,
  matchedMarketCap: bigint,
  aiReview: MarketAiReviewRow | null = null,
): MarketResponse {
  return {
    ...(aiReview ? { aiReview: serializeMarketAiReviewRow(aiReview) } : {}),
    bypassAiResolution: market.bypassAiResolution,
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

/**
 * Maps a persisted AI review row to its API shape, exposing the stored
 * verdict, scores, and evidence verbatim while normalizing dates to ISO
 * strings and omitting a missing model id.
 */
export function serializeMarketAiReviewRow(
  review: MarketAiReviewRow,
): MarketAiReviewResponse {
  return {
    createdAt: review.createdAt.toISOString(),
    evidence: review.evidence,
    hardFlags: review.hardFlags,
    id: review.id,
    metadataHash: review.metadataHash,
    ...(review.modelId ? { modelId: review.modelId } : {}),
    promptVersion: review.promptVersion,
    provider: review.provider,
    reasons: review.reasons,
    reviewedAt: review.reviewedAt.toISOString(),
    scores: review.scores,
    sourceChecks: review.sourceChecks,
    verdict: review.verdict,
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
    ...(metadata.resolutionSources.length > 0
      ? { resolutionSources: metadata.resolutionSources }
      : {}),
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

function receiptPlacedEventContractJoinCondition() {
  return and(
    eq(schema.contracts.id, schema.receiptPlacedEvents.contractId),
    eq(schema.contracts.chainId, schema.receiptPlacedEvents.chainId),
  );
}

function currentPregradManagerAddress() {
  return config.contracts.pregradManager.toLowerCase();
}

async function getLatestAiReviews(markets: MarketRow[]) {
  const reviews = new Map<string, MarketAiReviewRow>();
  if (markets.length === 0) {
    return reviews;
  }

  const chainIds = unique(markets.map((market) => market.chainId));
  const marketIds = unique(markets.map((market) => market.marketId));
  const rows = await db
    .select({ review: schema.marketAiReviews })
    .from(schema.marketAiReviews)
    .where(
      and(
        inArray(schema.marketAiReviews.chainId, chainIds),
        inArray(schema.marketAiReviews.marketId, marketIds),
      ),
    )
    .orderBy(
      desc(schema.marketAiReviews.reviewedAt),
      desc(schema.marketAiReviews.id),
    );

  for (const { review } of rows) {
    const key = marketReviewKey(review.chainId, review.marketId);
    if (!reviews.has(key)) {
      reviews.set(key, review);
    }
  }

  return reviews;
}

function marketReviewKey(chainId: number, marketId: bigint) {
  return `${chainId}:${marketId.toString()}`;
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
  localPublicClient ??= createReadOnlyClient();

  return localPublicClient;
}

/**
 * Parses the optional `since` query parameter, returning null for absent or
 * unparseable values so callers can distinguish "no filter" from "bad input"
 * by whether the raw value was provided.
 */
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

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}
