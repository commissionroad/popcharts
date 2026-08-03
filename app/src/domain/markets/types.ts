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
  MarketVenue as ApiMarketVenue,
  MarketVenuePool as ApiMarketVenuePool,
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

/**
 * One sample of a graduated market's traded prices on the bounded venue.
 *
 * Both prices are carried explicitly rather than deriving NO from YES: after
 * graduation the two outcomes trade in *separate* pools, so their prices are
 * independent observations that only sum to 100 once arbitrage has closed the
 * complete-set gap. Deriving one from the other would invent a price no swap
 * ever paid. Pre-graduation the same two prices come from one LMSR state, so
 * {@link PricePathPoint} carries YES alone.
 *
 * Always timestamped: a venue price exists only because a swap moved a pool.
 */
export type PostgradPricePoint = {
  /** ISO timestamp of the swap behind this sample. */
  at: string;
  noCents: number;
  yesCents: number;
};

/**
 * One outcome-token pool on the bounded postgrad venue. `apiMarketToMarket`
 * passes the wire value straight through, so this aliases the contract type
 * rather than copying it: a restated copy would keep compiling while silently
 * omitting any field the API later adds.
 *
 * `displayPriceWad` is a WAD decimal string (collateral per one outcome token)
 * and is absent while the pool is uninitialized.
 */
export type MarketVenuePool = ApiMarketVenuePool;

/**
 * Venue wiring for a graduated market's YES and NO outcome pools. Aliased for
 * the same pass-through reason as {@link MarketVenuePool}.
 */
export type MarketVenueInfo = ApiMarketVenue;

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

/**
 * Narrows an untrusted string — metadata read from the chain, an API body, or a
 * generated market — to a category the app offers. Lives beside the list it
 * checks so a new category cannot reach half the callers: every guard in the
 * app imports this one rather than re-testing `MARKET_CATEGORIES` itself.
 */
export function isMarketCategory(value: unknown): value is MarketCategory {
  return (
    typeof value === "string" && MARKET_CATEGORIES.includes(value as MarketCategory)
  );
}
