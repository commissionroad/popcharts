import type { StackPorts } from "../localStack/ports.ts";

/**
 * Resolves the resolution service port for a stack, preserving an explicit
 * local override while otherwise using the slot-derived resource (ADR 0020).
 */
export function localAiResolutionPort(resources: StackPorts): string {
  return (
    process.env.LOCAL_AI_RESOLUTION_PORT ?? String(resources.resolutionPort)
  );
}

/**
 * Resolves the resolution service base URL used by runners and readiness
 * probes from the same slot resource that configures the listener (ADR 0020).
 */
export function localAiResolutionBaseUrl(resources: StackPorts): string {
  return `http://127.0.0.1:${localAiResolutionPort(resources)}`;
}
