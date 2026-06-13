import { t } from "elysia";
import type { Static } from "@sinclair/typebox";

export type MarketStatus =
  | "bootstrap"
  | "graduating"
  | "graduated"
  | "resolved"
  | "refunded"
  | "cancelled";

export const MarketStatusSchema = t.Union([
  t.Literal("bootstrap"),
  t.Literal("graduating"),
  t.Literal("graduated"),
  t.Literal("resolved"),
  t.Literal("refunded"),
  t.Literal("cancelled"),
]);

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

export const GraduationRequestStubSchema = t.Object({
  message: t.String(),
  status: t.Literal("not_implemented"),
});

export type MarketResponse = Static<typeof MarketSchema>;
export type MarketCreatedEventResponse = Static<
  typeof MarketCreatedEventSchema
>;
export type GraduationRequestStubResponse = Static<
  typeof GraduationRequestStubSchema
>;
