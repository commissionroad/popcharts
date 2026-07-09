import type { AiResolutionConfig } from "../config";
import { resolveWithOllama } from "../ollama";
import type { ConfigValidationResult } from "../types";
import type { ResolutionProvider } from "./types";

/**
 * Local-model resolution provider backed by an Ollama runtime. It cannot browse,
 * so the pipeline must pre-collect evidence (requiresPreCollectedEvidence),
 * which the provider passes through unchanged into its finding.
 */
export const ollamaProvider: ResolutionProvider = {
  capabilities: {
    canRunOffline: true,
    requiresApiKey: false,
    requiresLocalRuntime: true,
    requiresPreCollectedEvidence: true,
    supportsNativeWebSearch: false,
  },
  name: "ollama",
  async resolve({ config, evidence, model, nowMs, request }) {
    const finding = await resolveWithOllama({
      config,
      evidence,
      model,
      nowMs,
      request,
    });

    return { ...finding, evidence };
  },
  validateConfig(config) {
    return validateOllamaConfig(config);
  },
};

function validateOllamaConfig(
  config: AiResolutionConfig,
): ConfigValidationResult {
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
    errors.push(
      "AI_RESOLUTION_OLLAMA_MODEL is required for Ollama resolution.",
    );
  }

  if (config.requestTimeoutMs <= 0) {
    errors.push("AI_RESOLUTION_TIMEOUT_MS must be positive.");
  }

  return { errors, warnings: [] };
}
