import { localAiResolutionBaseUrl } from "./localAiResolutionEndpoint.ts";

/**
 * Environment for the local AI resolution runner on top of the orchestrator's
 * server env: a stable runner id, a fast local poll interval, and the local
 * resolution service URL (all overridable through LOCAL_AI_RESOLUTION_*).
 */
export function buildAiResolutionRunnerEnv(
  serverEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...serverEnv,
    AI_RESOLUTION_RUNNER_ID:
      process.env.LOCAL_AI_RESOLUTION_RUNNER_ID ?? "local-ai-resolution-runner",
    AI_RESOLUTION_RUNNER_POLL_MS:
      process.env.LOCAL_AI_RESOLUTION_RUNNER_POLL_MS ?? "1000",
    AI_RESOLUTION_SERVICE_URL: localAiResolutionBaseUrl,
  };
}
