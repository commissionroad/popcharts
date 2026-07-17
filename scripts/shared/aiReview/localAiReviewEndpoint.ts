import type { StackPorts } from "../localStack/ports.ts";

/**
 * Resolves the review service port for a stack, preserving an explicit local
 * override while otherwise using the slot-derived resource (ADR 0020).
 */
export function localAiReviewPort(resources: StackPorts): string {
  return process.env.LOCAL_AI_REVIEW_PORT ?? String(resources.reviewPort);
}

/**
 * Resolves the review service base URL used by runners and readiness probes
 * from the same slot resource that configures the listener (ADR 0020).
 */
export function localAiReviewBaseUrl(resources: StackPorts): string {
  return `http://127.0.0.1:${localAiReviewPort(resources)}`;
}
