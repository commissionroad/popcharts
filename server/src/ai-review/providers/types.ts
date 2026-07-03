import type { AiReviewConfig } from "../config";
import type {
  ConfigValidationResult,
  EvidenceItem,
  MarketReviewRequest,
  PolicyFinding,
  PolicyFindingWithEvidence,
  ReviewProviderCapabilities,
  ReviewProviderName,
} from "../types";

/**
 * Everything a provider receives for one review: the service config, the
 * heuristic pre-pass finding, any pre-collected evidence, and an optional
 * model override from the request.
 */
export type ReviewProviderInput = {
  config: AiReviewConfig;
  evidence: EvidenceItem[];
  heuristic: PolicyFinding;
  model?: string;
  request: MarketReviewRequest;
};

/**
 * Uniform interface every review backend implements. validateConfig lets the
 * pipeline fail before calling review, and capabilities tell it whether to
 * collect evidence first; adding a backend means adding one implementation to
 * the registry.
 */
export type ReviewProvider = {
  capabilities: ReviewProviderCapabilities;
  name: ReviewProviderName;
  review(input: ReviewProviderInput): Promise<PolicyFindingWithEvidence>;
  validateConfig(config: AiReviewConfig): ConfigValidationResult;
};
