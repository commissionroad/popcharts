import type { StackPorts } from "../localStack/ports.ts";
import { localAiReviewPort } from "./localAiReviewEndpoint.ts";

/**
 * Environment for the local AI review service on top of the orchestrator's
 * server env. By default review runs on the host's logged-in Claude Code using
 * subscription auth; LOCAL_AI_REVIEW_PROVIDER=ollama|heuristic|anthropic
 * selects an alternative. Transient provider failures stay retryable by
 * default, while the heuristic provider remains available for deterministic
 * smoke tests. All values are overridable through the LOCAL_AI_REVIEW_*
 * variables documented in the orchestrators' --help output.
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
    AI_REVIEW_PROVIDER: process.env.LOCAL_AI_REVIEW_PROVIDER ?? "claude-cli",
    AI_REVIEW_RETRY_PROVIDER_FAILURES:
      process.env.LOCAL_AI_REVIEW_RETRY_PROVIDER_FAILURES ?? "true",
    AI_REVIEW_TIMEOUT_MS: process.env.LOCAL_AI_REVIEW_TIMEOUT_MS ?? "300000",
  };
}
