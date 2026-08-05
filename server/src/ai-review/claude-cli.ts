import { evidenceFromClaudeCliStream } from "./claude-cli/evidence";
import { parseClaudeCliStream } from "./claude-cli/stream";
import { buildCliReviewPrompt, parseCliReviewFinding } from "./cli-support";
import {
  cliExitError,
  runWithBunSpawn,
  type CliRunner,
} from "src/shared/cli-runner";
import type { AiReviewConfig } from "./config";
import type { EvidenceItem, MarketReviewRequest, PolicyFinding } from "./types";

/** Command runner seam so tests can fake the CLI without spawning processes. */
export type ClaudeCliRunner = CliRunner;

/**
 * Reviews a market by driving the host's logged-in Claude Code CLI in headless
 * print mode with native web search. Model output is treated as untrusted and
 * normalized through the same parsing path as the other review providers, and
 * the evidence returned alongside the finding is what the CLI's own tool
 * records prove was retrieved.
 */
export async function reviewWithClaudeCli({
  config,
  model,
  request,
  runCommand = runWithBunSpawn,
}: {
  config: Pick<
    AiReviewConfig,
    "claudeCliCommand" | "claudeCliModel" | "requestTimeoutMs"
  >;
  model?: string;
  request: MarketReviewRequest;
  runCommand?: ClaudeCliRunner;
}): Promise<PolicyFinding & { evidence: EvidenceItem[]; modelId: string }> {
  const modelId = model ?? config.claudeCliModel;
  const argv = [
    config.claudeCliCommand,
    "-p",
    buildCliReviewPrompt(request),
    "--model",
    modelId,
    "--allowedTools",
    "WebSearch,WebFetch",
    // stream-json rather than the simpler `json` envelope: only the streamed
    // transcript carries the WebSearch/WebFetch tool records that prove which
    // URLs were actually reached, and sourceChecks are credited against those.
    // In print mode stream-json requires --verbose.
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  // The CLI must authenticate with the host's Claude Code subscription login.
  // A set ANTHROPIC_API_KEY would shadow it and bill (or fail on) the API org
  // instead, so it is explicitly dropped from the child environment.
  const env: Record<string, string | undefined> = {
    ...process.env,
    ANTHROPIC_API_KEY: undefined,
  };
  const { exitCode, stderr, stdout } = await runCommand({
    argv,
    env,
    timeoutMs: config.requestTimeoutMs,
  });

  if (exitCode !== 0) {
    throw cliExitError("claude CLI", exitCode, stderr);
  }

  const stream = parseClaudeCliStream(stdout);
  const evidence = evidenceFromClaudeCliStream(stream);

  return {
    ...parseCliReviewFinding({
      evidence,
      modelId,
      raw: stream.result,
      source: "claude CLI",
    }),
    evidence,
  };
}
