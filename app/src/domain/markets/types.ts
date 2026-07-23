import type {
  AiReviewEvidence,
  AiReviewEvidenceKind,
  AiReviewProgress,
  AiReviewProvider,
  AiReviewScoreRationales,
  AiReviewScores as ApiAiReviewScores,
  AiReviewSourceCheck,
  AiReviewSourceTier,
  AiReviewVerdict,
  MarketStatus,
} from "@popcharts/api-client/models";

/**
 * Contract types the app consumes verbatim. They are re-exported rather than
 * restated so the OpenAPI schema stays their single definition: a member added
 * or removed server-side arrives here on the next client generation instead of
 * leaving a stale copy behind.
 */
export type {
  AiReviewEvidence,
  AiReviewEvidenceKind,
  AiReviewProgress,
  AiReviewProvider,
  AiReviewScoreRationales,
  AiReviewSourceCheck,
  AiReviewSourceTier,
  AiReviewVerdict,
  MarketStatus,
};

/**
 * Reviewer dimension scores on a 0-5 scale. Higher is better for every
 * dimension except disputeRisk and promptInjectionRisk, where higher means
 * more risk. Aliased rather than re-exported only so this note survives: the
 * server states the range in a JSDoc comment, which never reaches the OpenAPI
 * description and so is absent from the generated model.
 */
export type AiReviewScores = ApiAiReviewScores;

/**
 * App-side display taxonomy, deliberately not a contract type: the API carries
 * `MarketMetadata.category` as a free-form string, and `apiMarketToMarket`
 * narrows it to this list (falling back to a derived category) at the mapping
 * seam.
 */
export type MarketCategory =
  | "Crypto"
  | "Politics"
  | "Sports"
  | "Weather"
  | "Culture"
  | "Tech"
  | "Econ";

/**
 * The app's own outcome vocabulary, used well beyond API reads (LMSR pricing,
 * trade tickets, contract calls). The contract has no single side component to
 * alias — it spells the pair out per endpoint.
 */
export type MarketSide = "yes" | "no";

/**
 * The subset of a stored AI review the UI renders. Deliberately narrower than
 * the contract's `MarketAiReview`, which also carries persistence columns
 * (`id`, `createdAt`, `metadataHash`, `promptVersion`) no surface reads.
 */
export type MarketAiReview = {
  evidence: AiReviewEvidence[];
  hardFlags: string[];
  modelId?: string;
  provider: AiReviewProvider;
  reasons: string[];
  reviewedAt: string;
  scoreRationales: AiReviewScoreRationales;
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

/** One outcome-token pool on the bounded postgrad venue. */
export type MarketVenuePool = {
  /**
   * Current pool price as a WAD decimal string (collateral per one outcome
   * token). Absent while the pool is uninitialized.
   */
  displayPriceWad?: string;
  initialized: boolean;
  outcomeTokenAddress: string;
  poolId: string;
  whitelisted: boolean;
};

/** Venue wiring for a graduated market's YES and NO outcome pools. */
export type MarketVenueInfo = {
  boundedHookAddress: string;
  live: boolean;
  noPool: MarketVenuePool;
  orderManagerAddress: string;
  poolManagerAddress: string;
  yesPool: MarketVenuePool;
};

/**
 * Terminal resolution of a graduated market, from the postgrad market's
 * on-chain terminal event. `winningSide` is present for `resolved` (winning
 * tokens redeem 1:1 for collateral) and absent for a `cancelled` draw (both
 * sides redeem at half value).
 */
export type MarketResolution = {
  kind: "resolved" | "cancelled";
  /** Address of the postgrad market that pays redemptions. */
  postgradMarket: string;
  resolvedAt: string;
  winningSide?: MarketSide;
};

/** Where a graduated market's matched exposure settled after onchain handoff. */
export type MarketPostgradHandoff = {
  adapterAddress: string;
  completeSets: number;
  finalizedAt: string;
  marketAddress: string;
  refundedUsd: number;
  retainedUsd: number;
  venue?: MarketVenueInfo;
};

export type Market = {
  aiReview?: MarketAiReview;
  aiReviewProgress?: AiReviewProgress;
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
  postgrad?: MarketPostgradHandoff;
  pricePath: number[];
  question: string;
  receiptCount: number;
  resolution?: MarketResolution;
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
