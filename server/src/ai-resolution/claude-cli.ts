import {
  cliExitError,
  runWithBunSpawn,
  truncate,
  type CliRunner,
} from "src/shared/cli-runner";

import {
  buildCliResolutionPrompt,
  parseCliResolutionFinding,
} from "./cli-support";
import type { AiResolutionConfig } from "./config";
import type { MarketResolutionRequest, ResolutionFinding } from "./types";

/**
 * The slice of the headless CLI's `--output-format json` envelope this module
 * reads. `result` is the assistant's final text; `is_error` marks CLI-level
 * failures (auth, usage limits) that arrive with exit code 0.
 */
type ClaudeCliEnvelope = {
  is_error?: boolean;
  result?: string;
};

/** Command runner seam so tests can fake the CLI without spawning processes. */
export type ClaudeCliRunner = CliRunner;

/**
 * Resolves a market by driving the local `claude` CLI in headless print mode
 * with web search enabled. This is a LOCAL-DEV/eval provider: it requires the
 * developer's authenticated Claude Code install (subscription auth) on the
 * host, and never runs in a deployed environment — deployed networks use the
 * `anthropic` API provider. Model output is treated as untrusted exactly like
 * the other providers: unrecognized outcomes fall back to abstain, confidence
 * is clamped, and reasons/flags are string-filtered.
 */
export async function resolveWithClaudeCli({
  config,
  model,
  nowMs,
  request,
  runCommand = runWithBunSpawn,
}: {
  config: Pick<
    AiResolutionConfig,
    "claudeCliCommand" | "claudeCliModel" | "requestTimeoutMs"
  >;
  model?: string;
  nowMs: number;
  request: MarketResolutionRequest;
  runCommand?: ClaudeCliRunner;
}): Promise<ResolutionFinding & { modelId: string }> {
  const modelId = model ?? config.claudeCliModel;
  const argv = [
    config.claudeCliCommand,
    "-p",
    buildCliResolutionPrompt({ nowMs, request }),
    "--model",
    modelId,
    "--allowedTools",
    "WebSearch,WebFetch",
    "--output-format",
    "json",
  ];

  // The CLI must authenticate with the host's Claude Code subscription login.
  // A set ANTHROPIC_API_KEY would shadow it and bill (or fail on) the API
  // org instead, so it is explicitly dropped from the child environment.
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

  return parseCliResolutionFinding({
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
