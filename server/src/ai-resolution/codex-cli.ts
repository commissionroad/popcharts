import {
  cliExitError,
  runWithBunSpawn,
  type CliRunner,
} from "src/shared/cli-runner";
import { buildCodexExecArgv } from "src/shared/codex-exec-argv";

import {
  buildCliResolutionPrompt,
  parseCliResolutionFinding,
} from "./cli-support";
import type { AiResolutionConfig } from "./config";
import type { MarketResolutionRequest, ResolutionFinding } from "./types";

/**
 * Resolves a market by driving the host's Codex CLI in non-interactive mode
 * with the hosted web-search tool enabled. Requires a Codex CLI install on the
 * host. Unlike the Claude Code provider, its search runs on the provider's
 * servers, so the resolution host needs egress only to the Codex API rather
 * than to the open web. Model output is treated as untrusted exactly like the
 * other providers.
 */
export async function resolveWithCodexCli({
  config,
  model,
  nowMs,
  request,
  runCommand = runWithBunSpawn,
}: {
  config: Pick<
    AiResolutionConfig,
    "codexCliCommand" | "codexCliModel" | "requestTimeoutMs"
  >;
  model?: string;
  nowMs: number;
  request: MarketResolutionRequest;
  runCommand?: CliRunner;
}): Promise<ResolutionFinding & { modelId: string }> {
  const modelId = model ?? config.codexCliModel;
  const argv = buildCodexExecArgv({
    command: config.codexCliCommand,
    model: modelId,
    prompt: buildCliResolutionPrompt({ nowMs, request }),
  });
  // Codex resolves CODEX_API_KEY ahead of any cached interactive login, so the
  // host's own credential precedence decides billing: a key in the service
  // environment bills the API organization, otherwise the interactive login is
  // used. Nothing is stripped here.
  const env: Record<string, string | undefined> = { ...process.env };
  const { exitCode, stderr, stdout } = await runCommand({
    argv,
    env,
    timeoutMs: config.requestTimeoutMs,
  });

  if (exitCode !== 0) {
    throw cliExitError("codex CLI", exitCode, stderr);
  }

  // `codex exec` writes progress to stderr and the final agent message to
  // stdout, so stdout is the model's reply itself — there is no envelope to
  // unwrap, unlike the Claude Code provider.
  return parseCliResolutionFinding({
    modelId,
    raw: stdout,
    source: "codex CLI",
  });
}
