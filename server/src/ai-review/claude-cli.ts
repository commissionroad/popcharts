import {
  buildCliReviewPrompt,
  cliExitError,
  parseCliReviewFinding,
  runWithBunSpawn,
  truncate,
  type CliRunner,
} from "./cli-support";
import type { AiReviewConfig } from "./config";
import type { MarketReviewRequest, PolicyFinding } from "./types";

type ClaudeCliEnvelope = {
  is_error?: boolean;
  result?: string;
};

/** Command runner seam so tests can fake the CLI without spawning processes. */
export type ClaudeCliRunner = CliRunner;

/**
 * Reviews a market by driving the host's logged-in Claude Code CLI in headless
 * print mode with native web search. Model output is treated as untrusted and
 * normalized through the same parsing path as the other review providers.
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
}): Promise<PolicyFinding & { modelId: string }> {
  const modelId = model ?? config.claudeCliModel;
  const argv = [
    config.claudeCliCommand,
    "-p",
    buildCliReviewPrompt(request),
    "--model",
    modelId,
    "--allowedTools",
    "WebSearch,WebFetch",
    "--output-format",
    "json",
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

  const envelope = parseEnvelope(stdout);
  if (envelope.is_error) {
    throw new Error(
      `claude CLI reported an error result: ${truncate(envelope.result ?? "", 200)}`,
    );
  }

  return parseCliReviewFinding({
    modelId,
    raw: envelope.result ?? "",
    source: "claude CLI",
  });
}

function parseEnvelope(stdout: string): ClaudeCliEnvelope {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as ClaudeCliEnvelope;
    }
  } catch {
    // fall through to the error below
  }
  throw new Error(
    `claude CLI did not return a JSON envelope: ${truncate(stdout, 200)}`,
  );
}
