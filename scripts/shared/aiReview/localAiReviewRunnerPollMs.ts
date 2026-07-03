/**
 * Poll interval (in milliseconds, as an env string) for the local AI review
 * runner (LOCAL_AI_REVIEW_RUNNER_POLL_MS, default 1000). Exposed as a
 * function so overrides set after module load are still honored.
 */
export function localAiReviewRunnerPollMs(): string {
  return process.env.LOCAL_AI_REVIEW_RUNNER_POLL_MS ?? "1000";
}
