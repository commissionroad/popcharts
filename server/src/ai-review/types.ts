/**
 * How much of the web a review may touch: nothing, only the submitter's
 * resolution URLs, or full web search. Each step widens the attack surface,
 * so the mode is set by config/job — never by market text.
 */
export const INTERNET_ACCESS_MODES = [
  "off",
  "provided_urls",
  "search",
] as const;
export type InternetAccessMode = (typeof INTERNET_ACCESS_MODES)[number];

/** The review backends the service can route a market to. */
export const REVIEW_PROVIDER_NAMES = [
  "anthropic",
  "heuristic",
  "ollama",
] as const;
export type ReviewProviderName = (typeof REVIEW_PROVIDER_NAMES)[number];

/**
 * Static traits of a provider that the pipeline uses to decide what work to do
 * before calling it — notably whether evidence must be pre-collected because
 * the provider cannot browse on its own.
 */
export type ReviewProviderCapabilities = {
  canRunOffline: boolean;
  requiresApiKey: boolean;
  requiresLocalRuntime: boolean;
  requiresPreCollectedEvidence: boolean;
  supportsNativeWebSearch: boolean;
};

/**
 * Outcome of a provider's config check: errors block a review from starting,
 * warnings only surface in provider status responses.
 */
export type ConfigValidationResult = {
  errors: string[];
  warnings: string[];
};

/**
 * The submitter-authored market text under review. Every field is untrusted
 * user input and must be treated as potential prompt injection.
 */
export type MarketReviewMetadata = {
  category?: string;
  createdAt?: string;
  description?: string;
  metadataHash?: string;
  question: string;
  resolutionCriteria: string;
  resolutionSources?: string[];
  resolutionUrl?: string;
};

/** On-chain identifiers included in the prompt for traceability only. */
export type MarketReviewContext = {
  chainId?: number;
  creator?: string;
  marketId?: string;
};

/**
 * Per-request overrides of the service defaults, set by the operator or job
 * queue (never derived from market text): provider, model, and evidence
 * budgets.
 */
export type MarketReviewOptions = {
  fetchSearchResults?: boolean;
  internetAccess?: InternetAccessMode;
  maxSearchResults?: number;
  model?: string;
  provider?: ReviewProviderName;
};

/** One complete, stateless review request as accepted by the service. */
export type MarketReviewRequest = {
  context?: MarketReviewContext;
  metadata: MarketReviewMetadata;
  options?: MarketReviewOptions;
};

/**
 * Final review decision. approve moves the market to bootstrap, reject ends
 * it, and manual_review is the safe default whenever the pipeline is unsure.
 */
export type ReviewVerdict = "approve" | "reject" | "manual_review";

/** Trust classification of an evidence source, from best to worst. */
export type SourceTier =
  | "primary"
  | "major_news"
  | "specialist"
  | "ugc"
  | "suspicious"
  | "unreachable"
  | "unknown";

/**
 * The seven 0-5 policy dimensions every review must score, matching
 * MARKET_REVIEW_OUTPUT_CONTRACT. Higher is safer/better except disputeRisk
 * and promptInjectionRisk, where higher means more risk.
 */
export type ReviewScores = {
  contentSafety: number;
  corroboration: number;
  disputeRisk: number;
  objectivity: number;
  promptInjectionRisk: number;
  publicKnowability: number;
  sourceQuality: number;
};

/** Human-readable justification for every numeric reviewer dimension. */
export type ReviewScoreRationales = Record<keyof ReviewScores, string>;

/**
 * A reviewer judgment about one source. Only sources backed by actual
 * evidence survive into the stored result — see filterSourceChecksByEvidence.
 */
export type SourceCheck = {
  domain: string;
  notes: string;
  relevant: boolean;
  sourceTier: SourceTier;
  url: string;
};

/** How a piece of evidence entered the review pipeline. */
export type EvidenceKind = "provided_url" | "search_result" | "fetched_page";

/**
 * One retrieved (or unreachable) public source, recorded with its trust tier
 * and a truncated text summary so verdicts stay auditable after the fact.
 */
export type EvidenceItem = {
  domain: string;
  kind: EvidenceKind;
  sourceTier: SourceTier;
  summary: string;
  title?: string;
  url: string;
};

/**
 * The complete review the service returns and the runner persists: verdict,
 * scores, evidence trail, and the provider/model/prompt version that produced
 * it.
 */
export type ReviewResult = {
  evidence: EvidenceItem[];
  hardFlags: string[];
  modelId?: string;
  provider: ReviewProviderName;
  promptVersion: string;
  reasons: string[];
  scoreRationales: ReviewScoreRationales;
  scores: ReviewScores;
  sourceChecks: SourceCheck[];
  verdict: ReviewVerdict;
};

/**
 * A single reviewer's raw judgment (heuristic pass or one model call) before
 * findings are merged into the final ReviewResult.
 */
export type PolicyFinding = {
  hardFlags: string[];
  reasons: string[];
  scoreRationales: ReviewScoreRationales;
  scores: ReviewScores;
  /**
   * Deterministic pre-stage annotations (e.g. retrospective_question,
   * ephemeral_source). Unlike hardFlags they never reject, but a model
   * "approve" is capped to manual_review while any are present — plain code
   * caught a defect the model must not wave through.
   */
  softFlags?: string[];
  sourceChecks: SourceCheck[];
  verdict: ReviewVerdict;
};

/**
 * What a provider hands back to the pipeline: its finding plus the evidence
 * it used (native tool results, or the pre-collected set passed in) and the
 * model that produced it.
 */
export type PolicyFindingWithEvidence = PolicyFinding & {
  evidence: EvidenceItem[];
  modelId?: string;
};
