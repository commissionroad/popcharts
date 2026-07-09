import type { EvidenceItem } from "src/ai-review/types";

import type { AiResolutionConfig } from "../config";
import type {
  ConfigValidationResult,
  ResolutionFindingWithEvidence,
} from "../types";
import type { ResolutionProvider, ResolutionProviderInput } from "./types";

/**
 * One synthetic evidence item attached to a decided heuristic outcome. The
 * pipeline never auto-resolves with zero evidence, so the deterministic
 * heuristic must supply its own — this represents "the seeded marker is the
 * source of truth" for local dev, tests, and the smoke.
 */
const HEURISTIC_EVIDENCE: EvidenceItem = {
  domain: "heuristic.popcharts.local",
  kind: "provided_url",
  sourceTier: "primary",
  summary:
    "Deterministic heuristic outcome derived from the seeded market marker.",
  url: "heuristic://outcome-marker",
};

/**
 * Offline provider that echoes the heuristic pre-pass finding. Used whenever
 * `provider = heuristic` (local dev, tests, smoke); it never touches the network.
 */
export const heuristicProvider: ResolutionProvider = {
  capabilities: {
    canRunOffline: true,
    requiresApiKey: false,
    requiresLocalRuntime: false,
    requiresPreCollectedEvidence: false,
    supportsNativeWebSearch: false,
  },
  name: "heuristic",
  resolve(
    input: ResolutionProviderInput,
  ): Promise<ResolutionFindingWithEvidence> {
    const { heuristic } = input;
    const decided = heuristic.outcome === "yes" || heuristic.outcome === "no";

    return Promise.resolve({
      ...heuristic,
      evidence: decided ? [HEURISTIC_EVIDENCE] : [],
    });
  },
  validateConfig(_config: AiResolutionConfig): ConfigValidationResult {
    return { errors: [], warnings: [] };
  },
};
