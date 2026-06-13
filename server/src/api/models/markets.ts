import { t } from "elysia";
import type { Static } from "@sinclair/typebox";

export type MarketCategory =
  | "Crypto"
  | "Politics"
  | "Sports"
  | "Culture"
  | "Tech"
  | "Econ";

export type MarketStatus =
  | "bootstrap"
  | "graduating"
  | "graduated"
  | "resolved"
  | "refunded"
  | "cancelled";

export const MarketCategorySchema = t.Union([
  t.Literal("Crypto"),
  t.Literal("Politics"),
  t.Literal("Sports"),
  t.Literal("Culture"),
  t.Literal("Tech"),
  t.Literal("Econ"),
]);

export const MarketStatusSchema = t.Union([
  t.Literal("bootstrap"),
  t.Literal("graduating"),
  t.Literal("graduated"),
  t.Literal("resolved"),
  t.Literal("refunded"),
  t.Literal("cancelled"),
]);

export const MarketMetadataResponseSchema = t.Object({
  category: MarketCategorySchema,
  createdAt: t.String(),
  description: t.String(),
  metadataHash: t.String(),
  question: t.String(),
  resolutionCriteria: t.String(),
  resolutionUrl: t.Optional(t.String()),
  version: t.Literal(1),
});

export const CreateMarketMetadataBodySchema = t.Object({
  category: MarketCategorySchema,
  createdAt: t.Optional(t.String()),
  description: t.String(),
  question: t.String(),
  resolutionCriteria: t.String(),
  resolutionUrl: t.Optional(t.String()),
  version: t.Optional(t.Literal(1)),
});

export const CreateMarketMetadataResponseSchema = t.Object({
  metadata: MarketMetadataResponseSchema,
  metadataHash: t.String(),
});

export const MarketSchema = t.Object({
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
  metadata: t.Union([MarketMetadataResponseSchema, t.Null()]),
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

export type MarketMetadataResponse = Static<
  typeof MarketMetadataResponseSchema
>;
export type CreateMarketMetadataResponse = Static<
  typeof CreateMarketMetadataResponseSchema
>;
export type MarketResponse = Static<typeof MarketSchema>;
export type MarketCreatedEventResponse = Static<
  typeof MarketCreatedEventSchema
>;
