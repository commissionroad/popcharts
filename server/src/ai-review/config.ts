import {
  readBooleanOrFallback,
  readEnumOrFallback,
  readNonNegativeIntegerOrFallback,
  readPositiveIntegerOrFallback,
} from "src/shared/config-env";

import {
  EVIDENCE_MODES,
  INTERNET_ACCESS_MODES,
  REVIEW_PROVIDER_NAMES,
  SEARCH_PROVIDER_NAMES,
} from "./types";
import type {
  EvidenceMode,
  InternetAccessMode,
  ReviewProviderName,
  SearchProviderName,
} from "./types";

/**
 * Version tag persisted with every review so stored verdicts can be traced to
 * the prompt/policy revision that produced them. Bump when the policy or
 * output contract changes meaning.
 */
export const AI_REVIEW_PROMPT_VERSION = "market-ai-review-v6";

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
  claudeCliCommand: string;
  claudeCliModel: string;
  codexCliCommand: string;
  codexCliModel: string;
  /**
   * When the selected model provider is unavailable, keep the deterministic
   * heuristic verdict as-is instead of downgrading its `approve` to
   * `manual_review`. Off by default so production never auto-approves on a
   * model outage. Hard-flag rejects are unaffected — the heuristic gate still
   * rejects harmful markets regardless of this flag.
   */
  fallbackApprove: boolean;
  evidenceMode: EvidenceMode;
  fetchSearchResults: boolean;
  internetAccess: InternetAccessMode;
  maxFetchBytes: number;
  maxSearchResults: number;
  ollamaBaseUrl: string;
  ollamaModel: string;
  tavilyApiKey?: string;
  tavilyBaseUrl: string;
  tavilySearchDepth: string;
  openaiApiKey?: string;
  openaiBaseUrl: string;
  openaiMaxOutputTokens: number;
  openaiModel: string;
  port: number;
  provider: ReviewProviderName;
  searchProvider: SearchProviderName;
  requestTimeoutMs: number;
  retryProviderFailures: boolean;
  userAgent: string;
};

/**
 * Config read once from the environment at startup. Invalid numeric or enum
 * values fall back to defaults rather than crashing; the defaults suit local
 * development and deployment: the host's Codex CLI (`codex-cli`) on service
 * port 3002. Claude Code (`claude-cli`), Anthropic (API key), and Ollama remain
 * selectable alternatives.
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
  claudeCliCommand: process.env.AI_REVIEW_CLAUDE_CLI_COMMAND ?? "claude",
  claudeCliModel: process.env.AI_REVIEW_CLAUDE_CLI_MODEL ?? "sonnet",
  codexCliCommand: process.env.AI_REVIEW_CODEX_CLI_COMMAND ?? "codex",
  // Pinned deliberately: the Codex CLI resolves its default model from a
  // server-side catalogue, so an unpinned default can change tier — and cost —
  // without a deploy here.
  codexCliModel: process.env.AI_REVIEW_CODEX_CLI_MODEL ?? "gpt-5.6-luna",
  fallbackApprove: readBooleanOrFallback(
    process.env.AI_REVIEW_FALLBACK_APPROVE,
    false,
  ),
  // See the provider default below: evidence is collected once, by us, and
  // handed to the model with no tools. This is also what makes the audit
  // trail ours by construction rather than parsed out of a vendor's tool
  // records.
  evidenceMode: readEnumOrFallback(
    process.env.AI_REVIEW_EVIDENCE_MODE,
    EVIDENCE_MODES,
    "precollected",
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
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com",
  openaiMaxOutputTokens: readPositiveIntegerOrFallback(
    process.env.AI_REVIEW_OPENAI_MAX_OUTPUT_TOKENS,
    2048,
  ),
  // Pinned rather than left to an alias for the same reason codexCliModel is:
  // an alias can be repointed at a different tier server-side, changing both
  // verdict quality and cost without a deploy here.
  openaiModel: process.env.AI_REVIEW_OPENAI_MODEL ?? "gpt-5.6-luna",
  port: readPositiveIntegerOrFallback(process.env.AI_REVIEW_PORT, 3002),
  // These three defaults are one decision: deployed review runs Claude over
  // evidence we collected ourselves. Measured over 26 cases x 3 runs, that
  // scores identically to letting Claude browse (0.962 accuracy either way)
  // at $0.040 per review against roughly $0.113, with one fewer failure and
  // about 40% lower latency — because our own retrieval puts ~4k tokens in
  // context where native search puts ~20k.
  //
  // Local development deliberately differs: the orchestrators set
  // AI_REVIEW_PROVIDER=claude-cli in
  // scripts/shared/aiReview/buildAiReviewEnv.ts so a working local stack needs
  // no API keys, only a logged-in Claude Code. scripts/ never imports
  // server/src, so the split is maintained in both places on purpose rather
  // than shared.
  provider: readEnumOrFallback(
    process.env.AI_REVIEW_PROVIDER,
    REVIEW_PROVIDER_NAMES,
    "anthropic",
  ),
  // Which engine backs the pre-collected-evidence path. Tavily returns page
  // text inline, so a review makes no outbound page fetches of its own, and
  // it can read primary sources that refuse our crawler — bls.gov,
  // congress.gov and oscars.org all return 403 to the built-in fetcher and
  // full text through Tavily. Requires TAVILY_API_KEY; `duckduckgo` is the
  // key-free fallback used by the local stack.
  searchProvider: readEnumOrFallback(
    process.env.AI_REVIEW_SEARCH_PROVIDER,
    SEARCH_PROVIDER_NAMES,
    "tavily",
  ),
  tavilyApiKey: process.env.TAVILY_API_KEY,
  tavilyBaseUrl: process.env.TAVILY_BASE_URL ?? "https://api.tavily.com",
  tavilySearchDepth: process.env.AI_REVIEW_TAVILY_SEARCH_DEPTH ?? "basic",
  // Sized for the default codex-cli provider, which spawns a headless coding
  // CLI (tens of seconds to a few minutes); claude-cli is the same order. The
  // faster API/heuristic paths return well under this ceiling, so a generous
  // default is safe for them.
  requestTimeoutMs: readPositiveIntegerOrFallback(
    process.env.AI_REVIEW_TIMEOUT_MS,
    300_000,
  ),
  retryProviderFailures: readBooleanOrFallback(
    process.env.AI_REVIEW_RETRY_PROVIDER_FAILURES,
    false,
  ),
  userAgent:
    process.env.AI_REVIEW_USER_AGENT ??
    "PopChartsLocalAiReview/0.1 (+https://popcharts.local)",
};
