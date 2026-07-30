import { reviewWithCodexCli } from "../codex-cli";
import type { AiReviewConfig } from "../config";
import type { ConfigValidationResult } from "../types";
import type { ReviewProvider } from "./types";

/**
 * Drives the host's Codex CLI in non-interactive mode. Like the Claude Code
 * provider it needs a local CLI install, but its web search runs on the
 * provider's servers, so the review host needs egress only to the Codex API
 * rather than to the open web.
 */
export const codexCliProvider: ReviewProvider = {
  capabilities: {
    canRunOffline: false,
    requiresApiKey: false,
    requiresLocalRuntime: true,
    requiresPreCollectedEvidence: false,
    supportsNativeWebSearch: true,
  },
  name: "codex-cli",
  async review({ config, model, request }) {
    const finding = await reviewWithCodexCli({
      config,
      model,
      request,
    });

    return { ...finding, evidence: [] };
  },
  validateConfig(config) {
    return validateCodexCliConfig(config);
  },
};

function validateCodexCliConfig(
  config: AiReviewConfig,
): ConfigValidationResult {
  const errors: string[] = [];

  if (!config.codexCliCommand.trim()) {
    errors.push(
      "AI_REVIEW_CODEX_CLI_COMMAND is required for codex-cli review.",
    );
  }
  if (!config.codexCliModel.trim()) {
    errors.push("AI_REVIEW_CODEX_CLI_MODEL is required for codex-cli review.");
  }
  if (config.requestTimeoutMs <= 0) {
    errors.push("AI_REVIEW_TIMEOUT_MS must be positive.");
  }

  return { errors, warnings: [] };
}
