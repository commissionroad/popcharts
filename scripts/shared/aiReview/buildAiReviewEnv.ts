import { localAiReviewPort } from "./localAiReviewEndpoint.ts";

/**
 * Environment for the local AI review service on top of the orchestrator's
 * server env: heuristic provider with internet access and search-result
 * fetching off by default, overridable through the LOCAL_AI_REVIEW_*
 * variables documented in the orchestrators' --help output.
 */
export function buildAiReviewEnv(
  serverEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...serverEnv,
    AI_REVIEW_FETCH_SEARCH_RESULTS:
      process.env.LOCAL_AI_REVIEW_FETCH_SEARCH_RESULTS ?? "false",
    AI_REVIEW_INTERNET_ACCESS:
      process.env.LOCAL_AI_REVIEW_INTERNET_ACCESS ?? "off",
    AI_REVIEW_PORT: localAiReviewPort,
    AI_REVIEW_PROVIDER: process.env.LOCAL_AI_REVIEW_PROVIDER ?? "heuristic",
  };
}
