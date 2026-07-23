import {
  readBooleanOrFallback,
  readEnumOrFallback,
  readNonNegativeIntegerOrFallback,
  readPositiveIntegerOrFallback,
} from "src/shared/config-env";

import { INTERNET_ACCESS_MODES } from "src/ai-review/types";
import type { InternetAccessMode } from "src/ai-review/types";

/**
 * Version tag persisted with every resolution so stored verdicts can be traced
 * to the prompt/policy revision that produced them. Bump when the policy or
 * output contract changes meaning.
 */
export const AI_RESOLUTION_PROMPT_VERSION = "market-ai-resolution-v1";

/** Model providers the resolution service can call. `manual` (operator /
 * self-resolve) is a valid audit-row provider but never a service selection. */
export const RESOLUTION_MODEL_PROVIDER_NAMES = [
  "anthropic",
  "heuristic",
  "ollama",
] as const;

/** One of {@link RESOLUTION_MODEL_PROVIDER_NAMES}. */
export type ResolutionModelProviderName =
  (typeof RESOLUTION_MODEL_PROVIDER_NAMES)[number];

/**
 * Full runtime configuration of the AI Resolution service. Mirrors the AI
 * Review config (provider selection, per-provider endpoints, internet-access
 * mode, fetch/token budgets) and adds the abstention threshold — the confidence
 * floor below which a decided outcome parks for a human (ADR 0012).
 */
export type AiResolutionConfig = {
  abstentionThreshold: number;
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
  provider: ResolutionModelProviderName;
  requestTimeoutMs: number;
  userAgent: string;
};

/**
 * Config read once from the environment at startup. Invalid numeric or enum
 * values fall back to defaults rather than crashing; the defaults suit local
 * development (Ollama on 127.0.0.1, service port 3004, web search enabled).
 */
export const aiResolutionConfig: AiResolutionConfig = {
  abstentionThreshold: readUnitInterval(
    "RESOLUTION_ABSTENTION_THRESHOLD",
    0.85,
  ),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicBaseUrl:
    process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
  anthropicMaxOutputTokens: readPositiveIntegerOrFallback(
    process.env.AI_RESOLUTION_ANTHROPIC_MAX_OUTPUT_TOKENS,
    2_048,
  ),
  anthropicMaxWebFetches: readNonNegativeIntegerOrFallback(
    process.env.AI_RESOLUTION_ANTHROPIC_MAX_WEB_FETCHES,
    2,
  ),
  anthropicMaxWebSearches: readNonNegativeIntegerOrFallback(
    process.env.AI_RESOLUTION_ANTHROPIC_MAX_WEB_SEARCHES,
    3,
  ),
  anthropicModel:
    process.env.AI_RESOLUTION_ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
  anthropicWebFetchMaxContentTokens: readPositiveIntegerOrFallback(
    process.env.AI_RESOLUTION_ANTHROPIC_WEB_FETCH_MAX_CONTENT_TOKENS,
    12_000,
  ),
  fetchSearchResults: readBooleanOrFallback(
    process.env.AI_RESOLUTION_FETCH_SEARCH_RESULTS,
    false,
  ),
  internetAccess: readEnumOrFallback(
    process.env.AI_RESOLUTION_INTERNET_ACCESS,
    INTERNET_ACCESS_MODES,
    "search",
  ),
  maxFetchBytes: readPositiveIntegerOrFallback(
    process.env.AI_RESOLUTION_MAX_FETCH_BYTES,
    80_000,
  ),
  maxSearchResults: readPositiveIntegerOrFallback(
    process.env.AI_RESOLUTION_MAX_SEARCH_RESULTS,
    5,
  ),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  ollamaModel: process.env.AI_RESOLUTION_OLLAMA_MODEL ?? "gpt-oss:20b",
  port: readPositiveIntegerOrFallback(process.env.AI_RESOLUTION_PORT, 3004),
  provider: readEnumOrFallback(
    process.env.AI_RESOLUTION_PROVIDER,
    RESOLUTION_MODEL_PROVIDER_NAMES,
    "ollama",
  ),
  requestTimeoutMs: readPositiveIntegerOrFallback(
    process.env.AI_RESOLUTION_TIMEOUT_MS,
    8_000,
  ),
  userAgent:
    process.env.AI_RESOLUTION_USER_AGENT ??
    "PopChartsLocalAiResolution/0.1 (+https://popcharts.local)",
};

function readUnitInterval(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : fallback;
}
