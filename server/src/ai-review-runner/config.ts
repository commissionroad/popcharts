/**
 * Tuning knobs for the review job runner: queue timing (poll, lease, backoff,
 * attempts, batch size), the AI Review service endpoint, and the runner
 * identity stamped into locked_by for lease debugging.
 */
export type AiReviewRunnerConfig = {
  backoffMs: number;
  batchSize: number;
  /**
   * When true (default), terminal verdicts (approve / model reject) must be
   * corroborated by agreeing service runs before committing on-chain (ADR
   * 0019). Disable only for smoke tests and deterministic-provider setups.
   */
  corroborationEnabled: boolean;
  leaseMs: number;
  maxAttempts: number;
  pollMs: number;
  requestTimeoutMs: number;
  runnerId: string;
  serviceUrl: string;
};

const DEFAULT_SERVICE_URL = "http://127.0.0.1:3002";
const DEFAULT_BACKOFF_MS = 30_000;
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

// Defaults make the runner useful in local development with the review service
// on port 3002, while every timing/lease knob can be tuned per environment.
export function getAiReviewRunnerConfig(
  env: Record<string, string | undefined> = Bun.env,
): AiReviewRunnerConfig {
  return {
    backoffMs: readPositiveInteger(
      env.AI_REVIEW_RUNNER_BACKOFF_MS,
      DEFAULT_BACKOFF_MS,
      "AI_REVIEW_RUNNER_BACKOFF_MS",
    ),
    batchSize: readPositiveInteger(
      env.AI_REVIEW_RUNNER_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      "AI_REVIEW_RUNNER_BATCH_SIZE",
    ),
    corroborationEnabled: readBoolean(
      env.AI_REVIEW_RUNNER_CORROBORATION,
      true,
      "AI_REVIEW_RUNNER_CORROBORATION",
    ),
    leaseMs: readPositiveInteger(
      env.AI_REVIEW_RUNNER_LEASE_MS,
      DEFAULT_LEASE_MS,
      "AI_REVIEW_RUNNER_LEASE_MS",
    ),
    maxAttempts: readPositiveInteger(
      env.AI_REVIEW_RUNNER_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS,
      "AI_REVIEW_RUNNER_MAX_ATTEMPTS",
    ),
    pollMs: readPositiveInteger(
      env.AI_REVIEW_RUNNER_POLL_MS,
      DEFAULT_POLL_MS,
      "AI_REVIEW_RUNNER_POLL_MS",
    ),
    requestTimeoutMs: readPositiveInteger(
      env.AI_REVIEW_RUNNER_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
      "AI_REVIEW_RUNNER_REQUEST_TIMEOUT_MS",
    ),
    runnerId:
      env.AI_REVIEW_RUNNER_ID?.trim() || `ai-review-runner-${process.pid}`,
    serviceUrl: normalizeServiceUrl(
      env.AI_REVIEW_SERVICE_URL ?? DEFAULT_SERVICE_URL,
    ),
  };
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function readBoolean(
  value: string | undefined,
  fallback: boolean,
  name: string,
) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }

  throw new Error(`${name} must be true or false.`);
}

function normalizeServiceUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_SERVICE_URL;
  }

  return trimmed.replace(/\/+$/, "");
}
