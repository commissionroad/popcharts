import { reviewWithAnthropic } from "../anthropic";
import type { AiReviewConfig } from "../config";
import type { ConfigValidationResult } from "../types";
import type { ReviewProvider } from "./types";

/**
 * Claude-backed review provider. Browses via Anthropic's native web tools, so
 * it needs no pre-collected evidence, but it requires an API key and network
 * access — validateConfig blocks the review when either is misconfigured.
 */
export const anthropicProvider: ReviewProvider = {
  capabilities: {
    canRunOffline: false,
    requiresApiKey: true,
    requiresLocalRuntime: false,
    requiresPreCollectedEvidence: false,
    supportsNativeWebSearch: true,
  },
  name: "anthropic",
  async review({ config, model, request }) {
    return reviewWithAnthropic({
      config,
      model,
      request,
    });
  },
  validateConfig(config) {
    return validateAnthropicConfig(config);
  },
};

function validateAnthropicConfig(
  config: AiReviewConfig,
): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.anthropicApiKey) {
    errors.push("ANTHROPIC_API_KEY is required for Anthropic review.");
  }

  try {
    const url = new URL(config.anthropicBaseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      errors.push("ANTHROPIC_BASE_URL must use http or https.");
    }
  } catch {
    errors.push("ANTHROPIC_BASE_URL must be a valid URL.");
  }

  if (config.anthropicMaxOutputTokens <= 0) {
    errors.push("AI_REVIEW_ANTHROPIC_MAX_OUTPUT_TOKENS must be positive.");
  }

  if (config.anthropicMaxWebFetches < 0) {
    errors.push("AI_REVIEW_ANTHROPIC_MAX_WEB_FETCHES cannot be negative.");
  }

  if (config.anthropicMaxWebSearches < 0) {
    errors.push("AI_REVIEW_ANTHROPIC_MAX_WEB_SEARCHES cannot be negative.");
  }

  if (config.anthropicWebFetchMaxContentTokens <= 0) {
    errors.push(
      "AI_REVIEW_ANTHROPIC_WEB_FETCH_MAX_CONTENT_TOKENS must be positive.",
    );
  }

  if (
    config.internetAccess === "search" &&
    config.anthropicMaxWebSearches === 0
  ) {
    warnings.push("Claude native web search is disabled by max search cap 0.");
  }

  return {
    errors,
    warnings,
  };
}
