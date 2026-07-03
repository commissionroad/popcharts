import { reviewWithOllama } from "../ollama";
import type { AiReviewConfig } from "../config";
import type { ConfigValidationResult } from "../types";
import type { ReviewProvider } from "./types";

/**
 * Local-model review provider backed by an Ollama runtime. It cannot browse,
 * so the pipeline must pre-collect evidence (requiresPreCollectedEvidence),
 * which the provider passes through unchanged into its finding.
 */
export const ollamaProvider: ReviewProvider = {
  capabilities: {
    canRunOffline: true,
    requiresApiKey: false,
    requiresLocalRuntime: true,
    requiresPreCollectedEvidence: true,
    supportsNativeWebSearch: false,
  },
  name: "ollama",
  async review({ config, evidence, model, request }) {
    const finding = await reviewWithOllama({
      config,
      evidence,
      model,
      request,
    });

    return {
      ...finding,
      evidence,
    };
  },
  validateConfig(config) {
    return validateOllamaConfig(config);
  },
};

function validateOllamaConfig(config: AiReviewConfig): ConfigValidationResult {
  const errors: string[] = [];

  try {
    const url = new URL(config.ollamaBaseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      errors.push("OLLAMA_BASE_URL must use http or https.");
    }
  } catch {
    errors.push("OLLAMA_BASE_URL must be a valid URL.");
  }

  if (!config.ollamaModel.trim()) {
    errors.push("AI_REVIEW_OLLAMA_MODEL is required for Ollama review.");
  }

  if (config.requestTimeoutMs <= 0) {
    errors.push("AI_REVIEW_TIMEOUT_MS must be positive.");
  }

  return {
    errors,
    warnings: [],
  };
}
