import { t } from "elysia";
import type { Static } from "@sinclair/typebox";
import { MARKET_SIDES } from "@popcharts/protocol";

import {
  EVIDENCE_KINDS,
  REVIEW_PROVIDER_NAMES,
  REVIEW_VERDICTS,
  SOURCE_TIERS,
} from "src/ai-review/types";
import { JOB_STATUSES, JOB_TRIGGERS } from "src/db/schema/job-queue";
import { MARKET_STATUSES } from "src/db/schema/markets";
import { POSTGRAD_RESOLUTION_KINDS } from "src/db/schema/postgrad-resolution-events";
import { VENUE_ORDER_STATUSES } from "src/db/schema/venue-orders";
import { literalUnion } from "src/shared/typebox-literals";

/**
 * Market and AI-review API schemas.
 *
 * Every schema here carries an `$id` matching its registered model name and
 * references sibling schemas through `t.Ref`, so the exported OpenAPI spec
 * uses named `components.schemas` entries instead of inlined copies. That is
 * what keeps orval-generated client models named `Market` / `GraduationResponse`
 * rather than synthesized names like `graduationResponseMarket`.
 * Register new schemas in `src/api/routes/markets.ts` under the same name.
 */

/**
 * Re-exported from the schema module, which owns the status set so the
 * Postgres enum and this API schema cannot drift apart.
 */
export type { MarketStatus } from "src/db/schema/markets";

/** Lifecycle status of an indexed market, from creation through settlement. */
export const MarketStatusSchema = literalUnion(MARKET_STATUSES, {
  $id: "MarketStatus",
});

/** Why a graduation attempt was refused. */
export const GRADUATION_INELIGIBLE_REASONS = [
  "below_threshold",
  "clearing_pending",
  "onchain_settlement_required",
  "wrong_status",
] as const;

/** One of {@link GRADUATION_INELIGIBLE_REASONS}. */
export type GraduationIneligibleReason =
  (typeof GRADUATION_INELIGIBLE_REASONS)[number];

/** Why a dev-only pre-grad close was refused. */
export const DEV_MARKET_CLOSE_INELIGIBLE_REASONS = [
  "chain_status",
  "wrong_status",
] as const;

/** One of {@link DEV_MARKET_CLOSE_INELIGIBLE_REASONS}. */
export type DevMarketCloseIneligibleReason =
  (typeof DEV_MARKET_CLOSE_INELIGIBLE_REASONS)[number];

/**
 * Why a dev-only forced review was refused. Deliberately its own set rather
 * than a reuse of the close reasons it currently matches: the two endpoints
 * refuse for unrelated conditions and are free to diverge.
 */
export const DEV_MARKET_REVIEW_INELIGIBLE_REASONS = [
  "chain_status",
  "wrong_status",
] as const;

/** One of {@link DEV_MARKET_REVIEW_INELIGIBLE_REASONS}. */
export type DevMarketReviewIneligibleReason =
  (typeof DEV_MARKET_REVIEW_INELIGIBLE_REASONS)[number];

/** Why a dev-only end-to-end graduation was refused. */
export const DEV_MARKET_GRADUATE_INELIGIBLE_REASONS = [
  "adapter_unconfigured",
  "below_threshold",
  "chain_status",
  "past_deadline",
  "wrong_status",
] as const;

/** One of {@link DEV_MARKET_GRADUATE_INELIGIBLE_REASONS}. */
export type DevMarketGraduateIneligibleReason =
  (typeof DEV_MARKET_GRADUATE_INELIGIBLE_REASONS)[number];

/** Why a dev-only postgrad resolution was refused. */
export const DEV_MARKET_RESOLVE_INELIGIBLE_REASONS = [
  "already_resolved",
  "chain_status",
  "postgrad_missing",
  "wrong_status",
] as const;

/** One of {@link DEV_MARKET_RESOLVE_INELIGIBLE_REASONS}. */
export type DevMarketResolveIneligibleReason =
  (typeof DEV_MARKET_RESOLVE_INELIGIBLE_REASONS)[number];

/** Why a manual AI review request was refused. */
export const MANUAL_AI_REVIEW_INELIGIBLE_REASONS = [
  "missing_metadata",
  "wrong_status",
] as const;

/** One of {@link MANUAL_AI_REVIEW_INELIGIBLE_REASONS}. */
export type ManualAiReviewIneligibleReason =
  (typeof MANUAL_AI_REVIEW_INELIGIBLE_REASONS)[number];

/** Off-chain market metadata as returned by the read API. */
export const MarketMetadataSchema = t.Object(
  {
    category: t.String(),
    chainId: t.Number(),
    createdAt: t.String(),
    description: t.String(),
    metadataCreatedAt: t.String(),
    metadataHash: t.String(),
    outcomeNo: t.Optional(t.String()),
    outcomeYes: t.Optional(t.String()),
    question: t.String(),
    resolutionCriteria: t.String(),
    resolutionSources: t.Optional(t.Array(t.String())),
    resolutionUrl: t.Optional(t.String()),
    updatedAt: t.String(),
  },
  { $id: "MarketMetadata" },
);

/** Client-supplied market metadata payload; the hash must match the on-chain commitment. */
export const MarketMetadataWriteSchema = t.Object(
  {
    category: t.String({ minLength: 1 }),
    createdAt: t.String({ minLength: 1 }),
    description: t.String(),
    metadataHash: t.String({
      pattern: "^0x[0-9a-fA-F]{64}$",
    }),
    outcomeNo: t.Optional(t.String({ maxLength: 40, minLength: 1 })),
    outcomeYes: t.Optional(t.String({ maxLength: 40, minLength: 1 })),
    question: t.String({ minLength: 1 }),
    resolutionCriteria: t.String({ minLength: 1 }),
    resolutionSources: t.Optional(t.Array(t.String())),
    resolutionUrl: t.Optional(t.String()),
  },
  { $id: "MarketMetadataWrite" },
);

/** Backend that produced an AI review. */
export const AiReviewProviderSchema = literalUnion(REVIEW_PROVIDER_NAMES, {
  $id: "AiReviewProvider",
});

/** Overall AI-review outcome for a market's metadata. */
export const AiReviewVerdictSchema = literalUnion(REVIEW_VERDICTS, {
  $id: "AiReviewVerdict",
});

/** Per-dimension AI-review scores, each in [0, 5]. */
export const AiReviewScoresSchema = t.Object(
  {
    contentSafety: t.Number(),
    corroboration: t.Number(),
    disputeRisk: t.Number(),
    objectivity: t.Number(),
    promptInjectionRisk: t.Number(),
    publicKnowability: t.Number(),
    sourceQuality: t.Number(),
  },
  { $id: "AiReviewScores" },
);

/** Persisted explanation for each numeric AI-review score. */
export const AiReviewScoreRationalesSchema = t.Object(
  {
    contentSafety: t.String(),
    corroboration: t.String(),
    disputeRisk: t.String(),
    objectivity: t.String(),
    promptInjectionRisk: t.String(),
    publicKnowability: t.String(),
    sourceQuality: t.String(),
  },
  { $id: "AiReviewScoreRationales" },
);

/** Trust tier assigned to a cited source domain. */
export const AiReviewSourceTierSchema = literalUnion(SOURCE_TIERS, {
  $id: "AiReviewSourceTier",
});

/** Reviewer assessment of a single resolution source URL. */
export const AiReviewSourceCheckSchema = t.Object(
  {
    domain: t.String(),
    notes: t.String(),
    relevant: t.Boolean(),
    sourceTier: t.Ref(AiReviewSourceTierSchema),
    url: t.String(),
  },
  { $id: "AiReviewSourceCheck" },
);

/** A piece of evidence the reviewer gathered while evaluating a market. */
export const AiReviewEvidenceSchema = t.Object(
  {
    domain: t.String(),
    kind: literalUnion(EVIDENCE_KINDS),
    sourceTier: t.Ref(AiReviewSourceTierSchema),
    summary: t.String(),
    title: t.Optional(t.String()),
    url: t.String(),
  },
  { $id: "AiReviewEvidence" },
);

/** Stored AI review for a market metadata hash. */
export const MarketAiReviewSchema = t.Object(
  {
    createdAt: t.String(),
    evidence: t.Array(t.Ref(AiReviewEvidenceSchema)),
    hardFlags: t.Array(t.String()),
    id: t.Number(),
    metadataHash: t.String(),
    modelId: t.Optional(t.String()),
    promptVersion: t.String(),
    provider: t.Ref(AiReviewProviderSchema),
    reasons: t.Array(t.String()),
    reviewedAt: t.String(),
    scoreRationales: t.Ref(AiReviewScoreRationalesSchema),
    scores: t.Ref(AiReviewScoresSchema),
    sourceChecks: t.Array(t.Ref(AiReviewSourceCheckSchema)),
    verdict: t.Ref(AiReviewVerdictSchema),
  },
  { $id: "MarketAiReview" },
);

/** Sanitized review progress exposed on public market reads. */
export const AiReviewProgressSchema = t.Object(
  {
    phase: t.Union([
      t.Literal("awaiting_queue"),
      t.Literal("queued"),
      t.Literal("running"),
      t.Literal("retrying"),
      t.Literal("complete"),
      t.Literal("attention_required"),
    ]),
    status: t.Union([
      t.Literal("pending"),
      t.Literal("complete"),
      t.Literal("attention_required"),
    ]),
  },
  { $id: "AiReviewProgress" },
);

/** Queue state of an AI-review job. */
export const AiReviewJobStatusSchema = literalUnion(JOB_STATUSES, {
  $id: "AiReviewJobStatus",
});

/** What caused an AI-review job to be enqueued. */
export const AiReviewJobTriggerSchema = literalUnion(JOB_TRIGGERS, {
  $id: "AiReviewJobTrigger",
});

/** An AI-review job as tracked by the runner queue. */
export const MarketAiReviewJobSchema = t.Object(
  {
    attemptCount: t.Number(),
    chainId: t.Number(),
    completedAt: t.Optional(t.String()),
    createdAt: t.String(),
    id: t.Number(),
    lastError: t.Optional(t.String()),
    leaseUntil: t.Optional(t.String()),
    lockedBy: t.Optional(t.String()),
    marketId: t.String(),
    maxAttempts: t.Number(),
    metadataHash: t.String(),
    priority: t.Number(),
    requestedModel: t.Optional(t.String()),
    requestedProvider: t.Optional(t.Ref(AiReviewProviderSchema)),
    reviewId: t.Optional(t.Number()),
    runAfter: t.String(),
    status: t.Ref(AiReviewJobStatusSchema),
    trigger: t.Ref(AiReviewJobTriggerSchema),
    updatedAt: t.String(),
  },
  { $id: "MarketAiReviewJob" },
);

/** One outcome-token pool on the bounded v4 venue. */
export const MarketVenuePoolSchema = t.Object(
  {
    /**
     * Current pool price as a WAD decimal string (collateral paid per one
     * outcome token), derived from the pool's slot0. Omitted while the pool
     * is uninitialized and has no price yet.
     */
    displayPriceWad: t.Optional(t.String()),
    initialized: t.Boolean(),
    outcomeTokenAddress: t.String(),
    poolId: t.String(),
    whitelisted: t.Boolean(),
  },
  { $id: "MarketVenuePool" },
);

/** Venue wiring for a graduated market's YES and NO outcome pools. */
export const MarketVenueSchema = t.Object(
  {
    boundedHookAddress: t.String(),
    live: t.Boolean(),
    noPool: t.Ref(MarketVenuePoolSchema),
    orderManagerAddress: t.String(),
    poolManagerAddress: t.String(),
    yesPool: t.Ref(MarketVenuePoolSchema),
  },
  { $id: "MarketVenue" },
);

/** Which binary outcome a bounded-venue pool trades against collateral. */
export const VenuePoolSideSchema = literalUnion(MARKET_SIDES, {
  $id: "VenuePoolSide",
});

/**
 * Binary side accepted by the dev-only force resolve endpoint. Shares
 * MARKET_SIDES with VenuePoolSideSchema but keeps its own `$id`, so the two
 * stay distinct named components in the OpenAPI spec and the generated client.
 */
export const DevMarketResolveSideSchema = literalUnion(MARKET_SIDES, {
  $id: "DevMarketResolveSide",
});

/** Lifecycle status of an indexed bounded-venue maker order. */
export const VenueOrderStatusSchema = literalUnion(VENUE_ORDER_STATUSES, {
  $id: "VenueOrderStatus",
});

/**
 * Which side of the outcome's book a maker order rests on: an ask sells
 * outcome tokens for collateral, a bid buys them.
 */
export const VenueOrderDirectionSchema = t.Union(
  [t.Literal("bid"), t.Literal("ask")],
  { $id: "VenueOrderDirection" },
);

/**
 * One aggregated price level of a venue depth ladder: every open order
 * sharing a direction and tick range, summed. `priceWad` is the display price
 * (collateral per outcome token, WAD) at the tick-range edge nearest the
 * current pool price — the price at which the level starts to fill — and
 * `sizeWad` is the outcome-token quantity (WAD) the level's remaining
 * liquidity represents across its range.
 */
export const VenueOrderBookLevelSchema = t.Object(
  {
    orderCount: t.Number(),
    priceWad: t.String(),
    sizeWad: t.String(),
    tickLower: t.Number(),
    tickUpper: t.Number(),
  },
  { $id: "VenueOrderBookLevel" },
);

/**
 * Depth ladder for one outcome pool: asks sorted best (lowest price) first,
 * bids sorted best (highest price) first. `marketPriceWad` is the pool's
 * current display price, omitted while the pool is uninitialized or the
 * venue read fails.
 */
export const VenueOrderBookPoolSchema = t.Object(
  {
    asks: t.Array(t.Ref(VenueOrderBookLevelSchema)),
    bids: t.Array(t.Ref(VenueOrderBookLevelSchema)),
    marketPriceWad: t.Optional(t.String()),
    outcomeTokenAddress: t.String(),
    poolId: t.String(),
    side: t.Ref(VenuePoolSideSchema),
  },
  { $id: "VenueOrderBookPool" },
);

/**
 * Bounded-venue order book for one market. The YES and NO ladders are omitted
 * while the market has no indexed venue pools (not yet graduated).
 */
export const MarketOrderBookSchema = t.Object(
  {
    chainId: t.Number(),
    marketId: t.String(),
    no: t.Optional(t.Ref(VenueOrderBookPoolSchema)),
    yes: t.Optional(t.Ref(VenueOrderBookPoolSchema)),
  },
  { $id: "MarketOrderBook" },
);

/**
 * One indexed bounded-venue maker order. `priceWad` follows the ladder's
 * price convention; `sizeWad` / `remainingSizeWad` are the outcome-token
 * quantities (WAD) of the order's total and remaining liquidity over its
 * current tick range, and `amountIn` is the exact raw deposit (outcome tokens
 * for asks, collateral for bids).
 */
export const VenueOrderSchema = t.Object(
  {
    amountIn: t.String(),
    createdBlockTimestamp: t.String(),
    createdTransactionHash: t.String(),
    direction: t.Ref(VenueOrderDirectionSchema),
    orderId: t.Number(),
    owner: t.String(),
    poolId: t.String(),
    priceWad: t.String(),
    remainingSizeWad: t.String(),
    side: t.Ref(VenuePoolSideSchema),
    sizeWad: t.String(),
    status: t.Ref(VenueOrderStatusSchema),
    tickLower: t.Number(),
    tickUpper: t.Number(),
  },
  { $id: "VenueOrder" },
);

/** Maker orders for one market and owner, newest first. */
export const VenueOrderListSchema = t.Array(t.Ref(VenueOrderSchema), {
  $id: "VenueOrderList",
});

/** Where a graduated market's matched exposure settled after handoff. */
export const MarketPostgradSchema = t.Object(
  {
    adapterAddress: t.String(),
    completeSetCount: t.String(),
    finalizedAt: t.String(),
    marketAddress: t.String(),
    refundTotal: t.String(),
    retainedCostTotal: t.String(),
    transactionHash: t.String(),
    venue: t.Optional(t.Ref(MarketVenueSchema)),
  },
  { $id: "MarketPostgrad" },
);

/**
 * Terminal resolution of a graduated market, projected from the postgrad
 * market's MarketResolved/MarketCancelled event. `winningSide` is present for
 * `resolved` (winning tokens redeem 1:1 for collateral on `postgradMarket`)
 * and absent for a `cancelled` draw (both sides redeem at half value).
 */
export const MarketResolutionSchema = t.Object(
  {
    kind: literalUnion(POSTGRAD_RESOLUTION_KINDS),
    postgradMarket: t.String(),
    resolvedAt: t.String(),
    transactionHash: t.String(),
    winningSide: t.Optional(t.Ref(VenuePoolSideSchema)),
  },
  { $id: "MarketResolution" },
);

/** An indexed market projection, including optional metadata and AI review. */
export const MarketSchema = t.Object(
  {
    aiReview: t.Optional(t.Ref(MarketAiReviewSchema)),
    aiReviewProgress: t.Optional(t.Ref(AiReviewProgressSchema)),
    bypassAiResolution: t.Boolean(),
    chainId: t.Number(),
    collateral: t.String(),
    createdAt: t.String(),
    createdBlockNumber: t.String(),
    createdBlockTimestamp: t.String(),
    createdLogIndex: t.Number(),
    createdTransactionHash: t.String(),
    creator: t.String(),
    graduationThreshold: t.String(),
    graduationTime: t.String(),
    liquidityParameter: t.String(),
    marketId: t.String(),
    matchedMarketCap: t.String(),
    metadata: t.Optional(t.Ref(MarketMetadataSchema)),
    metadataHash: t.String(),
    noShares: t.String(),
    openingProbabilityWad: t.String(),
    postgrad: t.Optional(t.Ref(MarketPostgradSchema)),
    receiptCount: t.String(),
    resolution: t.Optional(t.Ref(MarketResolutionSchema)),
    resolutionTime: t.String(),
    status: t.Ref(MarketStatusSchema),
    totalEscrowed: t.String(),
    updatedAt: t.String(),
    yesShares: t.String(),
  },
  { $id: "Market" },
);

/** Ordered list of indexed markets. */
export const MarketListSchema = t.Array(t.Ref(MarketSchema), {
  $id: "MarketList",
});

/** Raw MarketCreated chain event as indexed. */
export const MarketCreatedEventSchema = t.Object(
  {
    bypassAiResolution: t.Boolean(),
    blockNumber: t.String(),
    blockTimestamp: t.String(),
    chainId: t.Number(),
    collateral: t.String(),
    creator: t.String(),
    graduationThreshold: t.String(),
    graduationTime: t.String(),
    graduationTimeUnix: t.String(),
    liquidityParameter: t.String(),
    logIndex: t.Number(),
    marketId: t.String(),
    metadata: t.String(),
    metadataHash: t.String(),
    openingProbabilityWad: t.String(),
    resolutionTime: t.String(),
    resolutionTimeUnix: t.String(),
    transactionHash: t.String(),
  },
  { $id: "MarketCreatedEvent" },
);

/** Chain events recorded for one market. */
export const MarketCreatedEventListSchema = t.Array(
  t.Ref(MarketCreatedEventSchema),
  { $id: "MarketCreatedEventList" },
);

/** Raw ReceiptPlaced chain event as indexed; side 0 is YES, side 1 is NO. */
export const ReceiptPlacedEventSchema = t.Object(
  {
    blockNumber: t.String(),
    blockTimestamp: t.String(),
    chainId: t.Number(),
    cost: t.String(),
    logIndex: t.Number(),
    marketId: t.String(),
    owner: t.String(),
    receiptId: t.String(),
    sequence: t.String(),
    shares: t.String(),
    side: t.Number(),
    transactionHash: t.String(),
  },
  { $id: "ReceiptPlacedEvent" },
);

/** Receipt events recorded for one market, ordered oldest first by sequence. */
export const ReceiptPlacedEventListSchema = t.Array(
  t.Ref(ReceiptPlacedEventSchema),
  { $id: "ReceiptPlacedEventList" },
);

/** Settlement totals recorded when a market graduates. */
export const GraduationSummarySchema = t.Object(
  {
    completeSetCount: t.String(),
    graduatedAt: t.String(),
    graduationThreshold: t.String(),
    matchedMarketCap: t.String(),
    noTokens: t.String(),
    receiptCount: t.String(),
    refundedCollateral: t.String(),
    totalEscrowed: t.String(),
    yesTokens: t.String(),
  },
  { $id: "GraduationSummary" },
);

/** Successful graduation result. */
export const GraduationResponseSchema = t.Object(
  {
    market: t.Ref(MarketSchema),
    status: t.Literal("graduated"),
    summary: t.Ref(GraduationSummarySchema),
  },
  { $id: "GraduationResponse" },
);

/** Graduation refusal, with the reason and current settlement totals. */
export const GraduationIneligibleSchema = t.Object(
  {
    message: t.String(),
    market: t.Ref(MarketSchema),
    reason: literalUnion(GRADUATION_INELIGIBLE_REASONS),
    status: t.Literal("ineligible"),
    summary: t.Ref(GraduationSummarySchema),
  },
  { $id: "GraduationIneligible" },
);

/** Result of a dev-only pre-grad market close. */
export const DevMarketCloseResponseSchema = t.Object(
  {
    market: t.Ref(MarketSchema),
    refundAvailable: t.String(),
    status: t.Literal("refunded"),
    transactionHash: t.Optional(t.String()),
  },
  { $id: "DevMarketCloseResponse" },
);

/** Dev-only close refusal, with the reason. */
export const DevMarketCloseIneligibleSchema = t.Object(
  {
    message: t.String(),
    market: t.Ref(MarketSchema),
    reason: literalUnion(DEV_MARKET_CLOSE_INELIGIBLE_REASONS),
    status: t.Literal("ineligible"),
  },
  { $id: "DevMarketCloseIneligible" },
);

/** Result of a dev-only forced market review. */
export const DevMarketReviewResponseSchema = t.Object(
  {
    market: t.Ref(MarketSchema),
    status: t.Literal("reviewed"),
    transactionHash: t.Optional(t.String()),
    verdict: t.Ref(AiReviewVerdictSchema),
  },
  { $id: "DevMarketReviewResponse" },
);

/** Dev-only forced-review refusal, with the reason. */
export const DevMarketReviewIneligibleSchema = t.Object(
  {
    message: t.String(),
    market: t.Ref(MarketSchema),
    reason: literalUnion(DEV_MARKET_REVIEW_INELIGIBLE_REASONS),
    status: t.Literal("ineligible"),
  },
  { $id: "DevMarketReviewIneligible" },
);

/** Result of a dev-only end-to-end market graduation. */
export const DevMarketGraduateResponseSchema = t.Object(
  {
    market: t.Ref(MarketSchema),
    postgrad: t.Ref(MarketPostgradSchema),
    status: t.Literal("graduated"),
    summary: t.Ref(GraduationSummarySchema),
    transactionHashes: t.Array(t.String()),
  },
  { $id: "DevMarketGraduateResponse" },
);

/** Dev-only graduation refusal, with the reason. */
export const DevMarketGraduateIneligibleSchema = t.Object(
  {
    message: t.String(),
    market: t.Ref(MarketSchema),
    reason: literalUnion(DEV_MARKET_GRADUATE_INELIGIBLE_REASONS),
    status: t.Literal("ineligible"),
  },
  { $id: "DevMarketGraduateIneligible" },
);

/** Result of a dev-only postgrad market resolution. */
export const DevMarketResolveResponseSchema = t.Object(
  {
    market: t.Ref(MarketSchema),
    status: t.Literal("resolved"),
    transactionHash: t.Optional(t.String()),
    winningSide: t.Ref(DevMarketResolveSideSchema),
  },
  { $id: "DevMarketResolveResponse" },
);

/** Dev-only resolution refusal, with the reason. */
export const DevMarketResolveIneligibleSchema = t.Object(
  {
    message: t.String(),
    market: t.Ref(MarketSchema),
    reason: literalUnion(DEV_MARKET_RESOLVE_INELIGIBLE_REASONS),
    status: t.Literal("ineligible"),
  },
  { $id: "DevMarketResolveIneligible" },
);

/** Operator request to enqueue a manual AI review. */
export const ManualAiReviewRequestSchema = t.Object(
  {
    force: t.Optional(t.Boolean()),
    model: t.Optional(t.String({ minLength: 1 })),
    provider: t.Optional(t.Ref(AiReviewProviderSchema)),
    reason: t.Optional(t.String()),
  },
  { $id: "ManualAiReviewRequest" },
);

/** Manual AI review accepted and queued. */
export const ManualAiReviewEnqueuedSchema = t.Object(
  {
    job: t.Ref(MarketAiReviewJobSchema),
    status: t.Literal("enqueued"),
  },
  { $id: "ManualAiReviewEnqueued" },
);

/** A matching AI-review job is already active; no new job was queued. */
export const ManualAiReviewExistingJobSchema = t.Object(
  {
    job: t.Ref(MarketAiReviewJobSchema),
    message: t.String(),
    status: t.Literal("already_queued"),
  },
  { $id: "ManualAiReviewExistingJob" },
);

/** The metadata hash was already reviewed; the stored review is returned. */
export const ManualAiReviewAlreadyReviewedSchema = t.Object(
  {
    aiReview: t.Ref(MarketAiReviewSchema),
    message: t.String(),
    status: t.Literal("already_reviewed"),
  },
  { $id: "ManualAiReviewAlreadyReviewed" },
);

/** Manual AI review refused for this market. */
export const ManualAiReviewIneligibleSchema = t.Object(
  {
    marketStatus: t.Optional(t.Ref(MarketStatusSchema)),
    message: t.String(),
    reason: literalUnion(MANUAL_AI_REVIEW_INELIGIBLE_REASONS),
    status: t.Literal("ineligible"),
  },
  { $id: "ManualAiReviewIneligible" },
);

/** 409 body for manual AI review requests: already reviewed or ineligible. */
export const ManualAiReviewConflictSchema = t.Union(
  [
    t.Ref(ManualAiReviewAlreadyReviewedSchema),
    t.Ref(ManualAiReviewIneligibleSchema),
  ],
  { $id: "ManualAiReviewConflict" },
);

/**
 * Response and request body types, each the `Static` projection of the
 * like-named schema above. Services and route handlers type their return
 * values with these so a handler that stops matching its schema fails to
 * compile rather than failing validation at runtime.
 */

export type MarketResponse = Static<typeof MarketSchema>;
export type MarketAiReviewResponse = Static<typeof MarketAiReviewSchema>;
export type MarketAiReviewJobResponse = Static<typeof MarketAiReviewJobSchema>;
export type MarketMetadataResponse = Static<typeof MarketMetadataSchema>;
export type MarketMetadataWrite = Static<typeof MarketMetadataWriteSchema>;
export type MarketCreatedEventResponse = Static<
  typeof MarketCreatedEventSchema
>;
export type ReceiptPlacedEventResponse = Static<
  typeof ReceiptPlacedEventSchema
>;
export type GraduationSummaryResponse = Static<typeof GraduationSummarySchema>;
export type GraduationResponse = Static<typeof GraduationResponseSchema>;
export type GraduationIneligibleResponse = Static<
  typeof GraduationIneligibleSchema
>;
export type DevMarketCloseResponse = Static<
  typeof DevMarketCloseResponseSchema
>;
export type DevMarketCloseIneligibleResponse = Static<
  typeof DevMarketCloseIneligibleSchema
>;
export type DevMarketReviewResponse = Static<
  typeof DevMarketReviewResponseSchema
>;
export type DevMarketReviewIneligibleResponse = Static<
  typeof DevMarketReviewIneligibleSchema
>;
export type VenuePoolSideResponse = Static<typeof VenuePoolSideSchema>;
export type VenueOrderStatusResponse = Static<typeof VenueOrderStatusSchema>;
export type VenueOrderDirectionResponse = Static<
  typeof VenueOrderDirectionSchema
>;
export type VenueOrderBookLevelResponse = Static<
  typeof VenueOrderBookLevelSchema
>;
export type VenueOrderBookPoolResponse = Static<
  typeof VenueOrderBookPoolSchema
>;
export type MarketOrderBookResponse = Static<typeof MarketOrderBookSchema>;
export type VenueOrderResponse = Static<typeof VenueOrderSchema>;
export type MarketVenuePoolResponse = Static<typeof MarketVenuePoolSchema>;
export type MarketVenueResponse = Static<typeof MarketVenueSchema>;
export type MarketPostgradResponse = Static<typeof MarketPostgradSchema>;
export type MarketResolutionResponse = Static<typeof MarketResolutionSchema>;
export type DevMarketGraduateResponse = Static<
  typeof DevMarketGraduateResponseSchema
>;
export type DevMarketGraduateIneligibleResponse = Static<
  typeof DevMarketGraduateIneligibleSchema
>;
export type ManualAiReviewRequest = Static<typeof ManualAiReviewRequestSchema>;
export type ManualAiReviewEnqueuedResponse = Static<
  typeof ManualAiReviewEnqueuedSchema
>;
export type ManualAiReviewExistingJobResponse = Static<
  typeof ManualAiReviewExistingJobSchema
>;
export type ManualAiReviewAlreadyReviewedResponse = Static<
  typeof ManualAiReviewAlreadyReviewedSchema
>;
export type ManualAiReviewIneligibleResponse = Static<
  typeof ManualAiReviewIneligibleSchema
>;
