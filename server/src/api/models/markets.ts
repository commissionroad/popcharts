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

export const MarketSchema = t.Object({
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

export type MarketResponse = Static<typeof MarketSchema>;
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
