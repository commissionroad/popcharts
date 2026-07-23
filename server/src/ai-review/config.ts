import {
  readBooleanOrFallback,
  readEnumOrFallback,
  readNonNegativeIntegerOrFallback,
  readPositiveIntegerOrFallback,
} from "src/shared/config-env";

import {
  INTERNET_ACCESS_MODES,
  REVIEW_PROVIDER_NAMES,
  type InternetAccessMode,
  type ReviewProviderName,
} from "./types";

/**
 * Version tag persisted with every review so stored verdicts can be traced to
 * the prompt/policy revision that produced them. Bump when the policy or
 * output contract changes meaning.
 */
export const AI_REVIEW_PROMPT_VERSION = "market-ai-review-v5";

/**
 * Full runtime configuration of the AI Review service: provider selection,
 * per-provider endpoints and models, internet-access mode, and the fetch/token
 * budgets that bound what untrusted market text can make the service do.
 */
export type AiReviewConfig = {
  anthropicApiKey?: string;
  anthropicBaseUrl: string;
  anthropicMaxOutputTokens: number;
  anthropicMaxWebFetches: number;
  anthropicMaxWebSearches: number;
  anthropicModel: string;
  anthropicWebFetchMaxContentTokens: number;
  /**
   * When the selected model provider is unavailable, keep the deterministic
   * heuristic verdict as-is instead of downgrading its `approve` to
   * `manual_review`. Off by default so production never auto-approves on a
   * model outage. Hard-flag rejects are unaffected — the heuristic gate still
   * rejects harmful markets regardless of this flag.
   */
  fallbackApprove: boolean;
  fetchSearchResults: boolean;
  internetAccess: InternetAccessMode;
  maxFetchBytes: number;
  maxSearchResults: number;
  ollamaBaseUrl: string;
  ollamaModel: string;
  port: number;
  provider: ReviewProviderName;
  requestTimeoutMs: number;
  retryProviderFailures: boolean;
  userAgent: string;
};

/**
 * Config read once from the environment at startup. Invalid numeric or enum
 * values fall back to defaults rather than crashing; the defaults suit local
 * development (Ollama on 127.0.0.1, service port 3002, web search enabled).
 */
export const aiReviewConfig: AiReviewConfig = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicBaseUrl:
    process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
  anthropicMaxOutputTokens: readPositiveIntegerOrFallback(
    process.env.AI_REVIEW_ANTHROPIC_MAX_OUTPUT_TOKENS,
    2_048,
  ),
  anthropicMaxWebFetches: readNonNegativeIntegerOrFallback(
    process.env.AI_REVIEW_ANTHROPIC_MAX_WEB_FETCHES,
    2,
  ),
  anthropicMaxWebSearches: readNonNegativeIntegerOrFallback(
    process.env.AI_REVIEW_ANTHROPIC_MAX_WEB_SEARCHES,
    3,
  ),
  anthropicModel: process.env.AI_REVIEW_ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
  anthropicWebFetchMaxContentTokens: readPositiveIntegerOrFallback(
    process.env.AI_REVIEW_ANTHROPIC_WEB_FETCH_MAX_CONTENT_TOKENS,
    12_000,
  ),
  fallbackApprove: readBooleanOrFallback(
    process.env.AI_REVIEW_FALLBACK_APPROVE,
    false,
  ),
  fetchSearchResults: readBooleanOrFallback(
    process.env.AI_REVIEW_FETCH_SEARCH_RESULTS,
    false,
  ),
  internetAccess: readEnumOrFallback(
    process.env.AI_REVIEW_INTERNET_ACCESS,
    INTERNET_ACCESS_MODES,
    "search",
  ),
  maxFetchBytes: readPositiveIntegerOrFallback(
    process.env.AI_REVIEW_MAX_FETCH_BYTES,
    80_000,
  ),
  maxSearchResults: readPositiveIntegerOrFallback(
    process.env.AI_REVIEW_MAX_SEARCH_RESULTS,
    5,
  ),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  ollamaModel: process.env.AI_REVIEW_OLLAMA_MODEL ?? "gpt-oss:20b",
  port: readPositiveIntegerOrFallback(process.env.AI_REVIEW_PORT, 3002),
  provider: readEnumOrFallback(
    process.env.AI_REVIEW_PROVIDER,
    REVIEW_PROVIDER_NAMES,
    "ollama",
  ),
  requestTimeoutMs: readPositiveIntegerOrFallback(
    process.env.AI_REVIEW_TIMEOUT_MS,
    8_000,
  ),
  retryProviderFailures: readBooleanOrFallback(
    process.env.AI_REVIEW_RETRY_PROVIDER_FAILURES,
    false,
  ),
  userAgent:
    process.env.AI_REVIEW_USER_AGENT ??
    "PopChartsLocalAiReview/0.1 (+https://popcharts.local)",
};
