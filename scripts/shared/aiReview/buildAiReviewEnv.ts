import { localAiReviewPort } from "./localAiReviewEndpoint.ts";

/**
 * Environment for the local AI review service on top of the orchestrator's
 * server env: the Ollama local-model provider with public source discovery, so
 * local review exercises the real agent-based path we want in production. The
 * deterministic heuristic stays a fallback — if the Ollama runtime is not up,
 * reviews degrade to it, and `AI_REVIEW_FALLBACK_APPROVE` lets a clean market
 * still approve locally instead of parking in manual review. All overridable
 * through the LOCAL_AI_REVIEW_* variables documented in the orchestrators'
 * --help output.
 */
export function buildAiReviewEnv(
  serverEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...serverEnv,
    AI_REVIEW_FALLBACK_APPROVE:
      process.env.LOCAL_AI_REVIEW_FALLBACK_APPROVE ?? "true",
    AI_REVIEW_FETCH_SEARCH_RESULTS:
      process.env.LOCAL_AI_REVIEW_FETCH_SEARCH_RESULTS ?? "false",
    AI_REVIEW_INTERNET_ACCESS:
      process.env.LOCAL_AI_REVIEW_INTERNET_ACCESS ?? "search",
    AI_REVIEW_PORT: localAiReviewPort,
    AI_REVIEW_PROVIDER: process.env.LOCAL_AI_REVIEW_PROVIDER ?? "ollama",
  };
}
