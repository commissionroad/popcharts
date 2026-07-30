import { resolveWithCodexCli } from "../codex-cli";
import type { AiResolutionConfig } from "../config";
import type { ConfigValidationResult } from "../types";
import type { ResolutionProvider } from "./types";

/**
 * Drives the host's Codex CLI in non-interactive mode, browsing with Codex's
 * hosted web search, so no pre-collected evidence is needed. Requires a Codex
 * CLI install on the host. Its search runs on the provider's servers, so the
 * resolution host needs egress only to the Codex API — unlike the claude-cli
 * provider, which fetches pages from the host itself.
 */
export const codexCliProvider: ResolutionProvider = {
  capabilities: {
    canRunOffline: false,
    requiresApiKey: false,
    requiresLocalRuntime: true,
    requiresPreCollectedEvidence: false,
    supportsNativeWebSearch: true,
  },
  name: "codex-cli",
  async resolve({ config, model, nowMs, request }) {
    const finding = await resolveWithCodexCli({
      config,
      model,
      nowMs,
      request,
    });

    // Evidence items are the pre-collection pipeline's shape; this provider
    // browses natively, so its trail lives in sourceChecks alone (same as
    // the anthropic provider's native-search path).
    return { ...finding, evidence: [] };
  },
  validateConfig(config) {
    return validateCodexCliConfig(config);
  },
};

function validateCodexCliConfig(
  config: AiResolutionConfig,
): ConfigValidationResult {
  const errors: string[] = [];

  if (!config.codexCliCommand.trim()) {
    errors.push(
      "AI_RESOLUTION_CODEX_CLI_COMMAND is required for codex-cli resolution.",
    );
  }
  if (!config.codexCliModel.trim()) {
    errors.push(
      "AI_RESOLUTION_CODEX_CLI_MODEL is required for codex-cli resolution.",
    );
  }
  if (config.requestTimeoutMs <= 0) {
    errors.push("AI_RESOLUTION_TIMEOUT_MS must be positive.");
  }

  return { errors, warnings: [] };
}
