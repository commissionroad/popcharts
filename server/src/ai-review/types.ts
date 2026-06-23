export type InternetAccessMode = "off" | "provided_urls" | "search";

export type ReviewProviderName = "anthropic" | "heuristic" | "ollama";

export type MarketReviewMetadata = {
  category?: string;
  createdAt?: string;
  description?: string;
  metadataHash?: string;
  question: string;
  resolutionCriteria: string;
  resolutionUrl?: string;
};

export type MarketReviewContext = {
  chainId?: number;
  creator?: string;
  marketId?: string;
};

export type MarketReviewOptions = {
  fetchSearchResults?: boolean;
  internetAccess?: InternetAccessMode;
  maxSearchResults?: number;
  model?: string;
  provider?: ReviewProviderName;
};

export type MarketReviewRequest = {
  context?: MarketReviewContext;
  metadata: MarketReviewMetadata;
  options?: MarketReviewOptions;
};

export type ReviewVerdict = "approve" | "reject" | "manual_review";

export type SourceTier =
  | "primary"
  | "major_news"
  | "specialist"
  | "ugc"
  | "suspicious"
  | "unreachable"
  | "unknown";

export type ReviewScores = {
  contentSafety: number;
  corroboration: number;
  disputeRisk: number;
  objectivity: number;
  promptInjectionRisk: number;
  publicKnowability: number;
  sourceQuality: number;
};

export type SourceCheck = {
  domain: string;
  notes: string;
  relevant: boolean;
  sourceTier: SourceTier;
  url: string;
};

export type EvidenceKind = "provided_url" | "search_result" | "fetched_page";

export type EvidenceItem = {
  domain: string;
  kind: EvidenceKind;
  sourceTier: SourceTier;
  summary: string;
  title?: string;
  url: string;
};

export type ReviewResult = {
  evidence: EvidenceItem[];
  hardFlags: string[];
  modelId?: string;
  provider: ReviewProviderName;
  promptVersion: string;
  reasons: string[];
  scores: ReviewScores;
  sourceChecks: SourceCheck[];
  verdict: ReviewVerdict;
};

export type PolicyFinding = {
  hardFlags: string[];
  reasons: string[];
  scores: ReviewScores;
  sourceChecks: SourceCheck[];
  verdict: ReviewVerdict;
};
