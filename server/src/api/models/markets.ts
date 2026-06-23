import { t } from "elysia";
import type { Static } from "@sinclair/typebox";

export type MarketStatus =
  | "under_review"
  | "bootstrap"
  | "graduating"
  | "graduated"
  | "resolved"
  | "refunded"
  | "cancelled"
  | "rejected";

export const MarketStatusSchema = t.Union([
  t.Literal("under_review"),
  t.Literal("bootstrap"),
  t.Literal("graduating"),
  t.Literal("graduated"),
  t.Literal("resolved"),
  t.Literal("refunded"),
  t.Literal("cancelled"),
  t.Literal("rejected"),
]);

export type GraduationIneligibleReason = "below_threshold" | "wrong_status";
export type DevMarketCloseIneligibleReason = "chain_status" | "wrong_status";

export const MarketMetadataSchema = t.Object({
  category: t.String(),
  chainId: t.Number(),
  createdAt: t.String(),
  description: t.String(),
  metadataCreatedAt: t.String(),
  metadataHash: t.String(),
  question: t.String(),
  resolutionCriteria: t.String(),
  resolutionUrl: t.Optional(t.String()),
  updatedAt: t.String(),
});

export const MarketMetadataWriteSchema = t.Object({
  category: t.String({ minLength: 1 }),
  createdAt: t.String({ minLength: 1 }),
  description: t.String(),
  metadataHash: t.String({
    pattern: "^0x[0-9a-fA-F]{64}$",
  }),
  question: t.String({ minLength: 1 }),
  resolutionCriteria: t.String({ minLength: 1 }),
  resolutionUrl: t.Optional(t.String()),
});

export const AiReviewProviderSchema = t.Union([
  t.Literal("anthropic"),
  t.Literal("heuristic"),
  t.Literal("ollama"),
]);

export const AiReviewVerdictSchema = t.Union([
  t.Literal("approve"),
  t.Literal("reject"),
  t.Literal("manual_review"),
]);

export const AiReviewScoresSchema = t.Object({
  contentSafety: t.Number(),
  corroboration: t.Number(),
  disputeRisk: t.Number(),
  objectivity: t.Number(),
  promptInjectionRisk: t.Number(),
  publicKnowability: t.Number(),
  sourceQuality: t.Number(),
});

export const AiReviewSourceTierSchema = t.Union([
  t.Literal("primary"),
  t.Literal("major_news"),
  t.Literal("specialist"),
  t.Literal("ugc"),
  t.Literal("suspicious"),
  t.Literal("unreachable"),
  t.Literal("unknown"),
]);

export const AiReviewSourceCheckSchema = t.Object({
  domain: t.String(),
  notes: t.String(),
  relevant: t.Boolean(),
  sourceTier: AiReviewSourceTierSchema,
  url: t.String(),
});

export const AiReviewEvidenceSchema = t.Object({
  domain: t.String(),
  kind: t.Union([
    t.Literal("provided_url"),
    t.Literal("search_result"),
    t.Literal("fetched_page"),
  ]),
  sourceTier: AiReviewSourceTierSchema,
  summary: t.String(),
  title: t.Optional(t.String()),
  url: t.String(),
});

export const MarketAiReviewSchema = t.Object({
  createdAt: t.String(),
  evidence: t.Array(AiReviewEvidenceSchema),
  hardFlags: t.Array(t.String()),
  id: t.Number(),
  metadataHash: t.String(),
  modelId: t.Optional(t.String()),
  promptVersion: t.String(),
  provider: AiReviewProviderSchema,
  reasons: t.Array(t.String()),
  reviewedAt: t.String(),
  scores: AiReviewScoresSchema,
  sourceChecks: t.Array(AiReviewSourceCheckSchema),
  verdict: AiReviewVerdictSchema,
});

export const MarketSchema = t.Object({
  aiReview: t.Optional(MarketAiReviewSchema),
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
  metadata: t.Optional(MarketMetadataSchema),
  metadataHash: t.String(),
  noShares: t.String(),
  openingProbabilityWad: t.String(),
  receiptCount: t.String(),
  resolutionTime: t.String(),
  status: MarketStatusSchema,
  totalEscrowed: t.String(),
  updatedAt: t.String(),
  yesShares: t.String(),
});

export const MarketCreatedEventSchema = t.Object({
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
  metadataHash: t.String(),
  openingProbabilityWad: t.String(),
  resolutionTime: t.String(),
  resolutionTimeUnix: t.String(),
  transactionHash: t.String(),
});

export const GraduationSummarySchema = t.Object({
  completeSetCount: t.String(),
  graduatedAt: t.String(),
  graduationThreshold: t.String(),
  matchedMarketCap: t.String(),
  noTokens: t.String(),
  receiptCount: t.String(),
  refundedCollateral: t.String(),
  totalEscrowed: t.String(),
  yesTokens: t.String(),
});

export const GraduationResponseSchema = t.Object({
  market: MarketSchema,
  status: t.Literal("graduated"),
  summary: GraduationSummarySchema,
});

export const GraduationIneligibleSchema = t.Object({
  message: t.String(),
  market: MarketSchema,
  reason: t.Union([t.Literal("below_threshold"), t.Literal("wrong_status")]),
  status: t.Literal("ineligible"),
  summary: GraduationSummarySchema,
});

export const DevMarketCloseResponseSchema = t.Object({
  market: MarketSchema,
  refundAvailable: t.String(),
  status: t.Literal("refunded"),
  transactionHash: t.Optional(t.String()),
});

export const DevMarketCloseIneligibleSchema = t.Object({
  message: t.String(),
  market: MarketSchema,
  reason: t.Union([t.Literal("chain_status"), t.Literal("wrong_status")]),
  status: t.Literal("ineligible"),
});

export type MarketResponse = Static<typeof MarketSchema>;
export type MarketAiReviewResponse = Static<typeof MarketAiReviewSchema>;
export type MarketMetadataResponse = Static<typeof MarketMetadataSchema>;
export type MarketMetadataWrite = Static<typeof MarketMetadataWriteSchema>;
export type MarketCreatedEventResponse = Static<
  typeof MarketCreatedEventSchema
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
