import type { InternetAccessMode, ReviewProviderName } from "./types";

export const AI_REVIEW_PROMPT_VERSION = "market-ai-review-v1";

export type AiReviewConfig = {
  anthropicApiKey?: string;
  anthropicBaseUrl: string;
  anthropicMaxOutputTokens: number;
  anthropicMaxWebFetches: number;
  anthropicMaxWebSearches: number;
  anthropicModel: string;
  anthropicWebFetchMaxContentTokens: number;
  fetchSearchResults: boolean;
  internetAccess: InternetAccessMode;
  maxFetchBytes: number;
  maxSearchResults: number;
  ollamaBaseUrl: string;
  ollamaModel: string;
  port: number;
  provider: ReviewProviderName;
  requestTimeoutMs: number;
  userAgent: string;
};

export const aiReviewConfig: AiReviewConfig = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicBaseUrl:
    process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
  anthropicMaxOutputTokens: readPositiveInteger(
    "AI_REVIEW_ANTHROPIC_MAX_OUTPUT_TOKENS",
    2_048,
  ),
  anthropicMaxWebFetches: readPositiveInteger(
    "AI_REVIEW_ANTHROPIC_MAX_WEB_FETCHES",
    2,
  ),
  anthropicMaxWebSearches: readPositiveInteger(
    "AI_REVIEW_ANTHROPIC_MAX_WEB_SEARCHES",
    3,
  ),
  anthropicModel: process.env.AI_REVIEW_ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
  anthropicWebFetchMaxContentTokens: readPositiveInteger(
    "AI_REVIEW_ANTHROPIC_WEB_FETCH_MAX_CONTENT_TOKENS",
    12_000,
  ),
  fetchSearchResults: readBoolean("AI_REVIEW_FETCH_SEARCH_RESULTS", false),
  internetAccess: readInternetAccessMode(
    process.env.AI_REVIEW_INTERNET_ACCESS ?? "search",
  ),
  maxFetchBytes: readPositiveInteger("AI_REVIEW_MAX_FETCH_BYTES", 80_000),
  maxSearchResults: readPositiveInteger("AI_REVIEW_MAX_SEARCH_RESULTS", 5),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  ollamaModel: process.env.AI_REVIEW_OLLAMA_MODEL ?? "gpt-oss:20b",
  port: readPositiveInteger("AI_REVIEW_PORT", 3002),
  provider: readProvider(process.env.AI_REVIEW_PROVIDER ?? "ollama"),
  requestTimeoutMs: readPositiveInteger("AI_REVIEW_TIMEOUT_MS", 8_000),
  userAgent:
    process.env.AI_REVIEW_USER_AGENT ??
    "PopChartsLocalAiReview/0.1 (+https://popcharts.local)",
};

function readPositiveInteger(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(name: string, fallback: boolean) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  return value === "true" || value === "1";
}

function readInternetAccessMode(value: string): InternetAccessMode {
  if (value === "off" || value === "provided_urls" || value === "search") {
    return value;
  }

  return "search";
}

function readProvider(value: string): ReviewProviderName {
  if (value === "anthropic" || value === "heuristic" || value === "ollama") {
    return value;
  }

  return "ollama";
}
