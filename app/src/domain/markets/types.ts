export type MarketStatus =
  | "under_review"
  | "bootstrap"
  | "graduating"
  | "graduated"
  | "resolved"
  | "refunded"
  | "cancelled"
  | "rejected";

export type MarketCategory =
  | "Crypto"
  | "Politics"
  | "Sports"
  | "Weather"
  | "Culture"
  | "Tech"
  | "Econ";

export type MarketSide = "yes" | "no";

export type Market = {
  b: number;
  category: MarketCategory;
  chainId?: number;
  closesAt: string;
  description: string;
  graduationTargetUsd: number;
  id: string;
  matchedUsd: number;
  noPriceCents: number;
  openingProbability: number;
  pricePath: number[];
  question: string;
  receiptCount: number;
  status: MarketStatus;
  volumeUsd: number;
  yesPriceCents: number;
};

export const MARKET_CATEGORIES: MarketCategory[] = [
  "Crypto",
  "Politics",
  "Sports",
  "Weather",
  "Tech",
  "Culture",
  "Econ",
];
