import type { EvidenceItem } from "src/ai-review/types";

import type { AiResolutionConfig } from "../config";
import type {
  ConfigValidationResult,
  MarketResolutionRequest,
  ResolutionFinding,
  ResolutionFindingWithEvidence,
  ResolutionModelProviderName,
  ResolutionProviderCapabilities,
} from "../types";

/**
 * Everything a provider receives for one resolution: the service config, the
 * heuristic pre-pass finding, any pre-collected evidence, an optional model
 * override, and the wall-clock the request was accepted at (so providers reason
 * about `too_early` against a single, injected time rather than reading a clock
 * mid-pipeline).
 */
export type ResolutionProviderInput = {
  config: AiResolutionConfig;
  evidence: EvidenceItem[];
  heuristic: ResolutionFinding;
  model?: string;
  nowMs: number;
  request: MarketResolutionRequest;
};

/**
 * Uniform interface every resolution backend implements. validateConfig lets the
 * pipeline fail before calling resolve, and capabilities tell it whether to
 * collect evidence first; adding a backend means adding one implementation to
 * the registry.
 */
export type ResolutionProvider = {
  capabilities: ResolutionProviderCapabilities;
  name: ResolutionModelProviderName;
  resolve(
    input: ResolutionProviderInput,
  ): Promise<ResolutionFindingWithEvidence>;
  validateConfig(config: AiResolutionConfig): ConfigValidationResult;
};
