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

export type ReviewProviderInput = {
  config: AiReviewConfig;
  evidence: EvidenceItem[];
  heuristic: PolicyFinding;
  model?: string;
  request: MarketReviewRequest;
};

export type ReviewProvider = {
  capabilities: ReviewProviderCapabilities;
  name: ReviewProviderName;
  review(input: ReviewProviderInput): Promise<PolicyFindingWithEvidence>;
  validateConfig(config: AiReviewConfig): ConfigValidationResult;
};
