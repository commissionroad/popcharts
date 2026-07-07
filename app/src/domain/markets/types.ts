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

export type AiReviewVerdict = "approve" | "reject" | "manual_review";

export type AiReviewProvider = "anthropic" | "heuristic" | "ollama";

export type AiReviewSourceTier =
  | "primary"
  | "major_news"
  | "specialist"
  | "ugc"
  | "suspicious"
  | "unreachable"
  | "unknown";

export type AiReviewEvidenceKind = "provided_url" | "search_result" | "fetched_page";

/**
 * Reviewer dimension scores on a 0-5 scale. Higher is better for every
 * dimension except disputeRisk and promptInjectionRisk, where higher means
 * more risk.
 */
export type AiReviewScores = {
  contentSafety: number;
  corroboration: number;
  disputeRisk: number;
  objectivity: number;
  promptInjectionRisk: number;
  publicKnowability: number;
  sourceQuality: number;
};

export type AiReviewEvidence = {
  domain: string;
  kind: AiReviewEvidenceKind;
  sourceTier: AiReviewSourceTier;
  summary: string;
  title?: string;
  url: string;
};

export type AiReviewSourceCheck = {
  domain: string;
  notes: string;
  relevant: boolean;
  sourceTier: AiReviewSourceTier;
  url: string;
};

export type MarketAiReview = {
  evidence: AiReviewEvidence[];
  hardFlags: string[];
  modelId?: string;
  provider: AiReviewProvider;
  reasons: string[];
  reviewedAt: string;
  scores: AiReviewScores;
  sourceChecks: AiReviewSourceCheck[];
  verdict: AiReviewVerdict;
};

/** One sample on a market's implied-probability history curve. */
export type PricePathPoint = {
  /** ISO timestamp of the trade behind this sample, when known. */
  at?: string;
  cents: number;
};

export type Market = {
  aiReview?: MarketAiReview;
  b: number;
  category: MarketCategory;
  chainId?: number;
  closesAt: string;
  createdAt?: string;
  creator?: string;
  description: string;
  graduationTargetUsd: number;
  id: string;
  matchedUsd: number;
  metadataHash?: string;
  noPriceCents: number;
  openingProbability: number;
  /** Creator-supplied display label for the NO outcome, when one was set. */
  outcomeNo?: string;
  /** Creator-supplied display label for the YES outcome, when one was set. */
  outcomeYes?: string;
  pricePath: number[];
  question: string;
  receiptCount: number;
  resolutionCriteria?: string;
  resolutionSources?: string[];
  resolutionUrl?: string;
  status: MarketStatus;
  volumeUsd: number;
  yesPriceCents: number;
};

/**
 * Display label for a market side: the creator-applied outcome label when one
 * exists, otherwise the canonical YES/NO.
 */
export function marketSideLabel(
  market: Pick<Market, "outcomeNo" | "outcomeYes">,
  side: MarketSide
) {
  return side === "yes" ? (market.outcomeYes ?? "YES") : (market.outcomeNo ?? "NO");
}

export const MARKET_CATEGORIES: MarketCategory[] = [
  "Crypto",
  "Politics",
  "Sports",
  "Weather",
  "Tech",
  "Culture",
  "Econ",
];
