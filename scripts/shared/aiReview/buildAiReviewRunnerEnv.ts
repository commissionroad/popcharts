import { localAiReviewBaseUrl } from "./localAiReviewEndpoint.ts";
import { localAiReviewRunnerPollMs } from "./localAiReviewRunnerPollMs.ts";

/**
 * Environment for the local AI review runner on top of the orchestrator's
 * server env: a stable runner id, the shared poll interval, and the local
 * review service URL (both overridable through LOCAL_AI_REVIEW_* variables).
 */
export function buildAiReviewRunnerEnv(
  serverEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...serverEnv,
    AI_REVIEW_RUNNER_ID:
      process.env.LOCAL_AI_REVIEW_RUNNER_ID ?? "local-ai-review-runner",
    AI_REVIEW_RUNNER_POLL_MS: localAiReviewRunnerPollMs(),
    AI_REVIEW_RUNNER_REQUEST_TIMEOUT_MS:
      process.env.LOCAL_AI_REVIEW_RUNNER_REQUEST_TIMEOUT_MS ?? "360000",
    AI_REVIEW_RUNNER_LEASE_MS:
      process.env.LOCAL_AI_REVIEW_RUNNER_LEASE_MS ?? "600000",
    AI_REVIEW_SERVICE_URL: localAiReviewBaseUrl,
  };
}
