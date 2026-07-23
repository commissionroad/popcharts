import { resolveWithClaudeCli } from "../claude-cli";
import type { AiResolutionConfig } from "../config";
import type { ConfigValidationResult } from "../types";
import type { ResolutionProvider } from "./types";

/**
 * Local-dev/eval provider that drives the host's authenticated `claude` CLI
 * in headless print mode. Browses with Claude Code's native WebSearch, so no
 * pre-collected evidence is needed. Requires a logged-in Claude Code install
 * on the host (subscription auth) — never available in deployed environments,
 * which use the `anthropic` API provider instead.
 */
export const claudeCliProvider: ResolutionProvider = {
  capabilities: {
    canRunOffline: false,
    requiresApiKey: false,
    requiresLocalRuntime: true,
    requiresPreCollectedEvidence: false,
    supportsNativeWebSearch: true,
  },
  name: "claude-cli",
  async resolve({ config, model, nowMs, request }) {
    const finding = await resolveWithClaudeCli({
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
    return validateClaudeCliConfig(config);
  },
};

function validateClaudeCliConfig(
  config: AiResolutionConfig,
): ConfigValidationResult {
  const errors: string[] = [];

  if (!config.claudeCliCommand.trim()) {
    errors.push(
      "AI_RESOLUTION_CLAUDE_CLI_COMMAND is required for claude-cli resolution.",
    );
  }
  if (!config.claudeCliModel.trim()) {
    errors.push(
      "AI_RESOLUTION_CLAUDE_CLI_MODEL is required for claude-cli resolution.",
    );
  }
  if (config.requestTimeoutMs <= 0) {
    errors.push("AI_RESOLUTION_TIMEOUT_MS must be positive.");
  }

  return { errors, warnings: [] };
}
