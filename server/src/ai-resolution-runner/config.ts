import {
  normalizeServiceUrl,
  readBoolean,
  readPositiveInteger,
  readUnitInterval,
} from "src/shared/config-env";

import { DEFAULT_ABSTENTION_THRESHOLD } from "src/ai-resolution/auto-resolvable";

/**
 * Tuning knobs for the resolution job runner: queue timing (poll, lease,
 * backoff, attempts, batch size), the AI Resolution service endpoint, and the
 * runner identity stamped into locked_by for lease debugging.
 */
export type AiResolutionRunnerConfig = {
  /**
   * The confidence floor this runner enforces itself before signing, read from
   * the same `RESOLUTION_ABSTENTION_THRESHOLD` variable the service reads and
   * falling back to the same shared default.
   *
   * Deliberately not taken from the service response: a threshold reported by
   * the party being checked is not a check. If the two ever disagree, both must
   * pass, so the stricter number wins — which is the point of enforcing it
   * twice.
   */
  abstentionThreshold: number;
  backoffMs: number;
  batchSize: number;
  /**
   * When true, resolve_yes / resolve_no must be corroborated by agreeing
   * service runs before submitting resolve() on-chain (ADR 0019).
   *
   * Defaults to OFF (2026-08-13 decision): corroboration costs 2-3 model calls
   * per submitting verdict, and it was restored on 2026-08-08 without the cost
   * being an explicit choice. Turn it on per deployment with
   * `AI_RESOLUTION_RUNNER_CORROBORATION=true`. ADR 0019's exit criteria still
   * want it on before a lone model verdict can move money — this default is a
   * cost decision, not a repeal.
   */
  corroborationEnabled: boolean;
  leaseMs: number;
  maxAttempts: number;
  pollMs: number;
  requestTimeoutMs: number;
  runnerId: string;
  serviceUrl: string;
};

const DEFAULT_SERVICE_URL = "http://127.0.0.1:3004";
const DEFAULT_BACKOFF_MS = 30_000;
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_LEASE_MS = 1_200_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_POLL_MS = 5_000;
// Must exceed the resolution service's own AI_RESOLUTION_TIMEOUT_MS (300s), or
// the runner aborts a request the service is still working on and burns an
// attempt. The lease in turn covers three such requests, matching the review
// runner's ratio.
const DEFAULT_REQUEST_TIMEOUT_MS = 360_000;

/**
 * Reads the runner config from the given env record (Bun.env by default).
 * Defaults make the runner useful in local development with the resolution
 * service on port 3004, while every timing/lease knob can be tuned per
 * environment; malformed knob values throw at startup rather than being
 * papered over.
 */
export function getAiResolutionRunnerConfig(
  env: Record<string, string | undefined> = Bun.env,
): AiResolutionRunnerConfig {
  return {
    abstentionThreshold: readUnitInterval(
      env.RESOLUTION_ABSTENTION_THRESHOLD,
      DEFAULT_ABSTENTION_THRESHOLD,
      "RESOLUTION_ABSTENTION_THRESHOLD",
    ),
    backoffMs: readPositiveInteger(
      env.AI_RESOLUTION_RUNNER_BACKOFF_MS,
      DEFAULT_BACKOFF_MS,
      "AI_RESOLUTION_RUNNER_BACKOFF_MS",
    ),
    batchSize: readPositiveInteger(
      env.AI_RESOLUTION_RUNNER_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      "AI_RESOLUTION_RUNNER_BATCH_SIZE",
    ),
    corroborationEnabled: readBoolean(
      env.AI_RESOLUTION_RUNNER_CORROBORATION,
      false,
      "AI_RESOLUTION_RUNNER_CORROBORATION",
    ),
    leaseMs: readPositiveInteger(
      env.AI_RESOLUTION_RUNNER_LEASE_MS,
      DEFAULT_LEASE_MS,
      "AI_RESOLUTION_RUNNER_LEASE_MS",
    ),
    maxAttempts: readPositiveInteger(
      env.AI_RESOLUTION_RUNNER_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS,
      "AI_RESOLUTION_RUNNER_MAX_ATTEMPTS",
    ),
    pollMs: readPositiveInteger(
      env.AI_RESOLUTION_RUNNER_POLL_MS,
      DEFAULT_POLL_MS,
      "AI_RESOLUTION_RUNNER_POLL_MS",
    ),
    requestTimeoutMs: readPositiveInteger(
      env.AI_RESOLUTION_RUNNER_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
      "AI_RESOLUTION_RUNNER_REQUEST_TIMEOUT_MS",
    ),
    runnerId:
      env.AI_RESOLUTION_RUNNER_ID?.trim() ||
      `ai-resolution-runner-${process.pid}`,
    serviceUrl: normalizeServiceUrl(
      env.AI_RESOLUTION_SERVICE_URL,
      DEFAULT_SERVICE_URL,
    ),
  };
}
