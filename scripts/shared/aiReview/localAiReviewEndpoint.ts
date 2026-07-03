/** Port the local AI review service listens on (LOCAL_AI_REVIEW_PORT, default 3002). */
export const localAiReviewPort: string =
  process.env.LOCAL_AI_REVIEW_PORT ?? "3002";

/**
 * Base URL of the local AI review service, used both to configure the API
 * and runner (AI_REVIEW_SERVICE_URL) and to poll `/ready` during startup.
 */
export const localAiReviewBaseUrl = `http://127.0.0.1:${localAiReviewPort}`;
