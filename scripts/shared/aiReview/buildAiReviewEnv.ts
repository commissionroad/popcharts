import type { StackPorts } from "../localStack/ports.ts";
import { localAiReviewPort } from "./localAiReviewEndpoint.ts";

/**
 * Environment for the local AI review service on top of the orchestrator's
 * server env. By default review runs on the host's Codex CLI;
 * LOCAL_AI_REVIEW_PROVIDER=claude-cli|ollama|heuristic|anthropic selects an
 * alternative. Transient provider failures stay retryable by default, while
 * the heuristic provider remains available for deterministic smoke tests. All
 * values are overridable through the LOCAL_AI_REVIEW_* variables documented in
 * the orchestrators' --help output.
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
    AI_REVIEW_PORT: localAiReviewPort(resources),
    // Mirrors the service-side fallback in server/src/ai-review/config.ts;
    // scripts/ deliberately never imports server/src, so the two cannot share
    // a constant. Change both together or the local stack and a deployed
    // service silently run different providers.
    AI_REVIEW_PROVIDER: process.env.LOCAL_AI_REVIEW_PROVIDER ?? "codex-cli",
    AI_REVIEW_RETRY_PROVIDER_FAILURES:
      process.env.LOCAL_AI_REVIEW_RETRY_PROVIDER_FAILURES ?? "true",
    AI_REVIEW_TIMEOUT_MS: process.env.LOCAL_AI_REVIEW_TIMEOUT_MS ?? "300000",
  };
}
