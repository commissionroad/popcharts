export type MarketStatus =
  | "bootstrap"
  | "graduating"
  | "graduated"
  | "resolved"
  | "refunded"
  | "cancelled";

export type MarketCategory =
  | "Crypto"
  | "Politics"
  | "Sports"
  | "Culture"
  | "Tech"
  | "Econ";

export type MarketSide = "yes" | "no";

export type Market = {
  b: number;
  category: MarketCategory;
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
  "Tech",
  "Culture",
  "Econ",
];
