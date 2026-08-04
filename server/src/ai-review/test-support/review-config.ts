import type { AiReviewConfig } from "../config";

/**
 * Hermetic `AiReviewConfig` for AI Review unit tests: dummy endpoints, small
 * budgets, and short timeouts, so nothing reaches a real provider.
 *
 * `AiReviewConfig` has no optional defaults by design — the service must never
 * silently run on a half-configured environment — which used to make every new
 * field a compile error in each test file carrying its own full literal. This
 * is the single place that has to grow when a field is added; tests state only
 * the values their assertions depend on.
 */
export const buildReviewConfig = (
  overrides: Partial<AiReviewConfig> = {},
): AiReviewConfig => ({
  anthropicBaseUrl: "https://api.anthropic.test",
  anthropicMaxOutputTokens: 512,
  anthropicMaxWebFetches: 1,
  anthropicMaxWebSearches: 1,
  anthropicModel: "claude-sonnet-4-6",
  anthropicWebFetchMaxContentTokens: 1_000,
  claudeCliCommand: "claude",
  claudeCliModel: "sonnet",
  codexCliCommand: "codex",
  codexCliModel: "gpt-5.6-luna",
  fallbackApprove: false,
  fetchSearchResults: false,
  internetAccess: "search",
  maxFetchBytes: 10_000,
  maxSearchResults: 3,
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "gpt-oss:20b",
  port: 3002,
  provider: "ollama",
  requestTimeoutMs: 100,
  retryProviderFailures: false,
  userAgent: "popcharts-test",
  ...overrides,
});
