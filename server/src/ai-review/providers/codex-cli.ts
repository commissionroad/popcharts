import { reviewWithCodexCli } from "../codex-cli";
import type { AiReviewConfig } from "../config";
import type { ConfigValidationResult } from "../types";
import type { ReviewProvider } from "./types";

/**
 * Drives the host's Codex CLI in non-interactive mode. Like the Claude Code
 * provider it needs a local CLI install, but its web search runs on the
 * provider's servers, so the review host needs egress only to the Codex API
 * rather than to the open web.
 *
 * It returns no evidence, and that is a limit of the CLI rather than an
 * omission here. `codex exec --json` emits a `web_search` item per call
 * carrying only the model's own query — never the URLs the hosted search
 * returned, and never a success/failure record for a page open (verified
 * against codex-cli 0.144.4: even "open this URL" is reported as
 * `action: {"type":"other"}` with the URL echoed as the query). Nothing in
 * that stream distinguishes a real retrieval from an invented one, so
 * crediting it would be trusting the model's word with extra steps. With no
 * evidence, `parseCliReviewFinding` drops every sourceCheck and caps
 * corroboration and sourceQuality — the safe reading of an unverifiable
 * claim.
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
