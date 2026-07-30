import { reviewWithClaudeCli } from "../claude-cli";
import type { AiReviewConfig } from "../config";
import type { ConfigValidationResult } from "../types";
import type { ReviewProvider } from "./types";

/**
 * Drives the host's logged-in Claude Code in headless print mode using
 * subscription auth. Requires a logged-in Claude Code install on the host.
 * Unlike codex-cli, its web search and page fetches originate from this host,
 * so the review host needs egress to the open web.
 */
export const claudeCliProvider: ReviewProvider = {
  capabilities: {
    canRunOffline: false,
    requiresApiKey: false,
    requiresLocalRuntime: true,
    requiresPreCollectedEvidence: false,
    supportsNativeWebSearch: true,
  },
  name: "claude-cli",
  async review({ config, model, request }) {
    const finding = await reviewWithClaudeCli({
      config,
      model,
      request,
    });

    return { ...finding, evidence: [] };
  },
  validateConfig(config) {
    return validateClaudeCliConfig(config);
  },
};

function validateClaudeCliConfig(
  config: AiReviewConfig,
): ConfigValidationResult {
  const errors: string[] = [];

  if (!config.claudeCliCommand.trim()) {
    errors.push(
      "AI_REVIEW_CLAUDE_CLI_COMMAND is required for claude-cli review.",
    );
  }
  if (!config.claudeCliModel.trim()) {
    errors.push(
      "AI_REVIEW_CLAUDE_CLI_MODEL is required for claude-cli review.",
    );
  }
  if (config.requestTimeoutMs <= 0) {
    errors.push("AI_REVIEW_TIMEOUT_MS must be positive.");
  }

  return { errors, warnings: [] };
}
