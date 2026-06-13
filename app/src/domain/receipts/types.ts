import type { MarketSide } from "@/domain/markets/types";

export type PriceBand = {
  fromProbability: number;
  toProbability: number;
};

export type Receipt = {
  averagePriceCents: number;
  collateralUsd: number;
  id: string;
  marketId: string;
  priceBand: PriceBand;
  shares: number;
  side: MarketSide;
};

export type MatchedSegment = {
  costUsd: number;
  priceBand: PriceBand;
  receiptId: string;
  shares: number;
  side: MarketSide;
};

export type RefundedSegment = {
  priceBand: PriceBand;
  receiptId: string;
  refundedUsd: number;
  side: MarketSide;
};
