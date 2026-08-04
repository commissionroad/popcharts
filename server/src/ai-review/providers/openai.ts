import type { AiReviewConfig } from "../config";
import { reviewWithOpenAi } from "../openai";
import type { ConfigValidationResult } from "../types";
import type { ReviewProvider } from "./types";

/**
 * OpenAI-backed review provider using the Responses API's native web search.
 *
 * Its evidence trail is the most complete of any provider here: the API
 * reports the full list of URLs each search consulted, not only the ones the
 * answer cited. It needs an API key and open-web egress from the review host.
 *
 * Distinct from codex-cli, which drives the Codex coding CLI. That path can
 * never report which URLs a search returned, so its claimed sources earn no
 * evidence credit; this one runs the same models with a real audit trail.
 */
export const openaiProvider: ReviewProvider = {
  capabilities: {
    canRunOffline: false,
    requiresApiKey: true,
    requiresLocalRuntime: false,
    requiresPreCollectedEvidence: false,
    supportsNativeWebSearch: true,
  },
  name: "openai",
  async review({ config, model, request }) {
    return reviewWithOpenAi({ config, model, request });
  },
  validateConfig(config) {
    return validateOpenAiConfig(config);
  },
};

function validateOpenAiConfig(config: AiReviewConfig): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.openaiApiKey) {
    errors.push("OPENAI_API_KEY is required for OpenAI review.");
  }

  try {
    const url = new URL(config.openaiBaseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      errors.push("OPENAI_BASE_URL must use http or https.");
    }
  } catch {
    errors.push("OPENAI_BASE_URL must be a valid URL.");
  }

  if (!config.openaiModel.trim()) {
    errors.push("AI_REVIEW_OPENAI_MODEL is required for OpenAI review.");
  }

  if (config.openaiMaxOutputTokens <= 0) {
    errors.push("AI_REVIEW_OPENAI_MAX_OUTPUT_TOKENS must be positive.");
  }

  if (config.requestTimeoutMs <= 0) {
    errors.push("AI_REVIEW_TIMEOUT_MS must be positive.");
  }

  if (config.internetAccess === "off") {
    warnings.push(
      "Web search is disabled by internet access mode off, so no source check can earn evidence credit.",
    );
  }

  return { errors, warnings };
}
