/** Port the local AI resolution service listens on (LOCAL_AI_RESOLUTION_PORT, default 3004). */
export const localAiResolutionPort: string =
  process.env.LOCAL_AI_RESOLUTION_PORT ?? "3004";

/**
 * Base URL of the local AI resolution service, used both to configure the
 * runner (AI_RESOLUTION_SERVICE_URL) and to poll `/ready` during startup.
 */
export const localAiResolutionBaseUrl = `http://127.0.0.1:${localAiResolutionPort}`;
