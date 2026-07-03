import type { ReviewProvider } from "./types";

/**
 * Model-free provider that returns the heuristic pre-pass finding as-is. It
 * needs no config or network, so it always validates — the guaranteed-available
 * fallback when no model backend is usable.
 */
export const heuristicProvider: ReviewProvider = {
  capabilities: {
    canRunOffline: true,
    requiresApiKey: false,
    requiresLocalRuntime: false,
    requiresPreCollectedEvidence: false,
    supportsNativeWebSearch: false,
  },
  name: "heuristic",
  async review({ evidence, heuristic }) {
    return {
      ...heuristic,
      evidence,
    };
  },
  validateConfig() {
    return {
      errors: [],
      warnings: [],
    };
  },
};
