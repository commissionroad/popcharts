import type {
  MarketAiReviewResponse,
  MarketCreatedEventResponse,
  MarketMetadataResponse,
  MarketMetadataWrite,
  MarketPostgradResponse,
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
import {
  computeMatchedMarketCap,
  pregradManagerAbi,
} from "@popcharts/protocol";
import { readPostgradMarketVenue } from "./postgrad-venue";

const MARKET_LIST_LIMIT = 200;

/** Drizzle select shape of a markets row, shared by the market services. */
export type MarketRow = typeof schema.markets.$inferSelect;
/** Drizzle select shape of a market_ai_reviews row. */
export type MarketAiReviewRow = typeof schema.marketAiReviews.$inferSelect;
export type MarketAiReviewJobRow =
  typeof schema.marketAiReviewJobs.$inferSelect;
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
  const liveMarkets = liveRows.map(({ market }) => market);
  const reviews = await getLatestAiReviews(liveMarkets);
  const reviewJobs = await getLatestAiReviewJobs(liveMarkets);
  const postgrads = await getLatestPostgradInfos(liveMarkets);
  const matchedCaps = await loadMatchedMarketCaps(liveMarkets);

  return liveRows.map(({ market, metadata }) =>
    serializeMarketRow(
      market,
      metadata,
      matchedCaps.get(marketReviewKey(market.chainId, market.marketId)) ?? 0n,
      reviews.get(marketReviewKey(market.chainId, market.marketId)) ?? null,
      postgrads.get(marketReviewKey(market.chainId, market.marketId)) ?? null,
      reviewJobs.get(marketReviewKey(market.chainId, market.marketId)) ?? null,
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
  const reviewJobs = await getLatestAiReviewJobs([row.market]);
  const postgrads = await getLatestPostgradInfos([row.market]);
  let postgrad =
    postgrads.get(marketReviewKey(row.market.chainId, row.market.marketId)) ??
    null;

  // Single-market reads also report the venue side of the handoff so the UI
  // can point at the live postgrad pools. Kept off the list endpoint to avoid
  // per-market chain reads there.
  if (postgrad) {
    const venue = await readPostgradMarketVenue({
      collateral: row.market.collateral as `0x${string}`,
      postgradMarket: postgrad.marketAddress as `0x${string}`,
    });

    if (venue) {
      postgrad = { ...postgrad, venue };
    }
  }

  const matchedCaps = await loadMatchedMarketCaps([row.market]);

  return serializeMarketRow(
    row.market,
    row.metadata,
    matchedCaps.get(marketReviewKey(row.market.chainId, row.market.marketId)) ??
      0n,
    reviews.get(marketReviewKey(row.market.chainId, row.market.marketId)) ??
      null,
    postgrad,
    reviewJobs.get(marketReviewKey(row.market.chainId, row.market.marketId)) ??
      null,
  );
}

/**
 * Loads one market row for the configured PregradManager, or null when the
 * market is unknown or (locally) no longer exists on-chain — the same
 * existence rules getMarketById applies, without the serialization work.
 */
export async function selectLiveMarketRow({
  chainId,
  marketId,
}: {
  chainId: number;
  marketId: bigint;
}): Promise<MarketRow | null> {
  const rows = await db
    .select({ market: schema.markets })
    .from(schema.markets)
    .innerJoin(schema.contracts, marketContractJoinCondition())
    .where(
      and(
        eq(schema.contracts.address, currentPregradManagerAddress()),
        eq(schema.contracts.chainId, config.chainId),
        eq(schema.markets.chainId, chainId),
        eq(schema.markets.marketId, marketId),
      ),
    )
    .limit(1);
  const row = rows[0];

  if (!row || !(await isLiveLocalMarket(marketId))) {
    return null;
  }

  return row.market;
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
    outcomeNo: metadata.outcomeNo ?? null,
    outcomeYes: metadata.outcomeYes ?? null,
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
  postgrad: MarketPostgradResponse | null = null,
  aiReviewJob: MarketAiReviewJobRow | null = null,
): MarketResponse {
  const aiReviewProgress = serializeAiReviewProgress({
    job: aiReviewJob,
    market,
    review: aiReview,
  });

  return {
    ...(aiReview ? { aiReview: serializeMarketAiReviewRow(aiReview) } : {}),
    ...(aiReviewProgress ? { aiReviewProgress } : {}),
    ...(postgrad ? { postgrad } : {}),
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
    scoreRationales: review.scoreRationales,
    scores: review.scores,
    sourceChecks: review.sourceChecks,
    verdict: review.verdict,
  };
}

function serializeAiReviewProgress({
  job,
  market,
  review,
}: {
  job: MarketAiReviewJobRow | null;
  market: MarketRow;
  review: MarketAiReviewRow | null;
}): MarketResponse["aiReviewProgress"] {
  if (review) {
    return { phase: "complete", status: "complete" };
  }

  if (job?.status === "terminal_failed") {
    return {
      phase: "attention_required",
      status: "attention_required",
    };
  }

  if (market.status !== "under_review") {
    return undefined;
  }

  if (job?.status === "running") {
    return { phase: "running", status: "pending" };
  }

  if (job?.status === "retryable_failed") {
    return { phase: "retrying", status: "pending" };
  }

  if (job?.status === "queued") {
    return { phase: "queued", status: "pending" };
  }

  return { phase: "awaiting_queue", status: "pending" };
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
    ...(metadata.outcomeNo ? { outcomeNo: metadata.outcomeNo } : {}),
    ...(metadata.outcomeYes ? { outcomeYes: metadata.outcomeYes } : {}),
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

async function getLatestAiReviewJobs(markets: MarketRow[]) {
  const jobs = new Map<string, MarketAiReviewJobRow>();
  if (markets.length === 0) {
    return jobs;
  }

  const chainIds = unique(markets.map((market) => market.chainId));
  const marketIds = unique(markets.map((market) => market.marketId));
  const rows = await db
    .select({ job: schema.marketAiReviewJobs })
    .from(schema.marketAiReviewJobs)
    .where(
      and(
        inArray(schema.marketAiReviewJobs.chainId, chainIds),
        inArray(schema.marketAiReviewJobs.marketId, marketIds),
      ),
    )
    .orderBy(
      desc(schema.marketAiReviewJobs.createdAt),
      desc(schema.marketAiReviewJobs.id),
    );

  for (const { job } of rows) {
    const key = marketReviewKey(job.chainId, job.marketId);
    if (!jobs.has(key)) {
      jobs.set(key, job);
    }
  }

  return jobs;
}

/**
 * Computes the real band-pass matched market cap for each market from its
 * indexed receipts — the sum of min(YES,NO coverage)·width across price bands.
 * This is what graduates the market and drives the graduate button; it is always
 * `<= min(totalYesShares, totalNoShares)` and strictly less when demand does not
 * overlap in price. Batched over the whole page so the list endpoint issues one
 * query, not one per market.
 */
async function loadMatchedMarketCaps(
  markets: MarketRow[],
): Promise<Map<string, bigint>> {
  const caps = new Map<string, bigint>();
  if (markets.length === 0) {
    return caps;
  }

  const chainIds = unique(markets.map((market) => market.chainId));
  const marketIds = unique(markets.map((market) => market.marketId));
  const rows = await db
    .select({
      chainId: schema.receiptPlacedEvents.chainId,
      marketId: schema.receiptPlacedEvents.marketId,
      rHigh: schema.receiptPlacedEvents.rHigh,
      rLow: schema.receiptPlacedEvents.rLow,
      side: schema.receiptPlacedEvents.side,
    })
    .from(schema.receiptPlacedEvents)
    .where(
      and(
        inArray(schema.receiptPlacedEvents.chainId, chainIds),
        inArray(schema.receiptPlacedEvents.marketId, marketIds),
      ),
    );

  const byMarket = new Map<
    string,
    Array<{ rHigh: bigint; rLow: bigint; side: number }>
  >();
  for (const row of rows) {
    const key = marketReviewKey(row.chainId, row.marketId);
    const list = byMarket.get(key) ?? [];
    list.push({
      rHigh: BigInt(row.rHigh),
      rLow: BigInt(row.rLow),
      side: row.side,
    });
    byMarket.set(key, list);
  }

  for (const market of markets) {
    const key = marketReviewKey(market.chainId, market.marketId);
    caps.set(key, computeMatchedMarketCap(byMarket.get(key) ?? []));
  }

  return caps;
}

function marketReviewKey(chainId: number, marketId: bigint) {
  return `${chainId}:${marketId.toString()}`;
}

/** Drizzle select shape of a graduation_finalized_events row. */
export type GraduationFinalizedRow =
  typeof schema.graduationFinalizedEvents.$inferSelect;

/**
 * Maps a GraduationFinalized event row to the postgrad handoff shape exposed
 * on graduated markets: where the matched exposure settled and what it minted.
 */
export function serializePostgradRow(
  row: GraduationFinalizedRow,
): MarketPostgradResponse {
  return {
    adapterAddress: row.postgradAdapter,
    completeSetCount: row.completeSetCount.toString(),
    finalizedAt: row.blockTimestamp.toISOString(),
    marketAddress: row.postgradMarket,
    refundTotal: row.refundTotal.toString(),
    retainedCostTotal: row.retainedCostTotal.toString(),
    transactionHash: row.transactionHash,
  };
}

/** Serializes the latest GraduationFinalized record for one market, if any. */
export async function selectPostgradInfo({
  chainId,
  marketId,
}: {
  chainId: number;
  marketId: bigint;
}): Promise<MarketPostgradResponse | null> {
  const rows = await db
    .select()
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
  const row = rows[0];

  return row ? serializePostgradRow(row) : null;
}

async function getLatestPostgradInfos(markets: MarketRow[]) {
  const infos = new Map<string, MarketPostgradResponse>();
  const settledMarkets = markets.filter(
    (market) => market.status === "graduated" || market.status === "resolved",
  );
  if (settledMarkets.length === 0) {
    return infos;
  }

  const chainIds = unique(settledMarkets.map((market) => market.chainId));
  const marketIds = unique(settledMarkets.map((market) => market.marketId));
  const rows = await db
    .select()
    .from(schema.graduationFinalizedEvents)
    .where(
      and(
        inArray(schema.graduationFinalizedEvents.chainId, chainIds),
        inArray(schema.graduationFinalizedEvents.marketId, marketIds),
      ),
    )
    .orderBy(
      desc(schema.graduationFinalizedEvents.blockNumber),
      desc(schema.graduationFinalizedEvents.logIndex),
    );

  for (const row of rows) {
    const key = marketReviewKey(row.chainId, row.marketId);
    if (!infos.has(key)) {
      infos.set(key, serializePostgradRow(row));
    }
  }

  return infos;
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
      abi: pregradManagerAbi,
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
