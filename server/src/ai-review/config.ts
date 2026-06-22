import type { InternetAccessMode, ReviewProviderName } from "./types";

export const AI_REVIEW_PROMPT_VERSION = "market-ai-review-v1";

export type AiReviewConfig = {
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
  return value === "heuristic" ? "heuristic" : "ollama";
}
