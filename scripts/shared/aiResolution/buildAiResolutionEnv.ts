import type { StackPorts } from "../localStack/ports.ts";
import { localAiResolutionPort } from "./localAiResolutionEndpoint.ts";

/**
 * Environment for the local AI resolution service on top of the orchestrator's
 * server env: heuristic provider with internet access off by default,
 * overridable through the LOCAL_AI_RESOLUTION_* variables.
 */
export function buildAiResolutionEnv(
  serverEnv: NodeJS.ProcessEnv,
  resources: StackPorts,
): NodeJS.ProcessEnv {
  return {
    ...serverEnv,
    AI_RESOLUTION_INTERNET_ACCESS:
      process.env.LOCAL_AI_RESOLUTION_INTERNET_ACCESS ?? "off",
    AI_RESOLUTION_PORT: localAiResolutionPort(resources),
    AI_RESOLUTION_PROVIDER:
      process.env.LOCAL_AI_RESOLUTION_PROVIDER ?? "heuristic",
  };
}
