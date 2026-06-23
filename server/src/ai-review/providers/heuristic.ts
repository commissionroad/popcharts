import type { ReviewProvider } from "./types";

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
