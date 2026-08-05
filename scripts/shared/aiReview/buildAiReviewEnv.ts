import type { StackPorts } from "../localStack/ports.ts";
import { localAiReviewPort } from "./localAiReviewEndpoint.ts";

/**
 * Environment for the local AI review service on top of the orchestrator's
 * server env.
 *
 * Local review deliberately differs from deployed review. Deployed runs the
 * Anthropic API over evidence the service collects through Tavily, which needs
 * ANTHROPIC_API_KEY and TAVILY_API_KEY. Requiring either to bring up a local
 * stack would put a paid dependency in front of `just local-dev`, so local
 * runs the host's logged-in Claude Code instead: same family of model, no
 * keys, and it browses for itself.
 *
 * That is why the three review defaults are pinned here rather than inherited
 * from server/src/ai-review/config.ts — the divergence is the point, not
 * drift. LOCAL_AI_REVIEW_PROVIDER=anthropic|codex-cli|ollama|heuristic selects
 * an alternative, and every value is overridable through the
 * LOCAL_AI_REVIEW_* variables documented in the orchestrators' --help output.
 */
export function buildAiReviewEnv(
  serverEnv: NodeJS.ProcessEnv,
  resources: StackPorts,
): NodeJS.ProcessEnv {
  return {
    ...serverEnv,
    AI_REVIEW_FALLBACK_APPROVE:
      process.env.LOCAL_AI_REVIEW_FALLBACK_APPROVE ?? "false",
    AI_REVIEW_FETCH_SEARCH_RESULTS:
      process.env.LOCAL_AI_REVIEW_FETCH_SEARCH_RESULTS ?? "false",
    AI_REVIEW_INTERNET_ACCESS:
      process.env.LOCAL_AI_REVIEW_INTERNET_ACCESS ?? "search",
    // claude-cli browses for itself, so the local stack collects no evidence
    // and needs no Tavily key. Deployed review uses the opposite pair
    // (precollected + tavily); see the note above.
    AI_REVIEW_EVIDENCE_MODE:
      process.env.LOCAL_AI_REVIEW_EVIDENCE_MODE ?? "native",
    AI_REVIEW_PORT: localAiReviewPort(resources),
    AI_REVIEW_PROVIDER: process.env.LOCAL_AI_REVIEW_PROVIDER ?? "claude-cli",
    AI_REVIEW_SEARCH_PROVIDER:
      process.env.LOCAL_AI_REVIEW_SEARCH_PROVIDER ?? "duckduckgo",
    AI_REVIEW_RETRY_PROVIDER_FAILURES:
      process.env.LOCAL_AI_REVIEW_RETRY_PROVIDER_FAILURES ?? "true",
    AI_REVIEW_TIMEOUT_MS: process.env.LOCAL_AI_REVIEW_TIMEOUT_MS ?? "300000",
  };
}
