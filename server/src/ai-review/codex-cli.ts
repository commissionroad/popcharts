import { buildCliReviewPrompt, parseCliReviewFinding } from "./cli-support";
import {
  cliExitError,
  runWithBunSpawn,
  type CliRunner,
} from "src/shared/cli-runner";
import { buildCodexExecArgv } from "src/shared/codex-exec-argv";
import type { AiReviewConfig } from "./config";
import type { MarketReviewRequest, PolicyFinding } from "./types";

/**
 * Reviews a market by driving the host's Codex CLI in non-interactive mode
 * with the hosted web-search tool enabled. Model output is treated as
 * untrusted and normalized through the same parsing path as the other review
 * providers.
 */
export async function reviewWithCodexCli({
  config,
  model,
  request,
  runCommand = runWithBunSpawn,
}: {
  config: Pick<
    AiReviewConfig,
    "codexCliCommand" | "codexCliModel" | "requestTimeoutMs"
  >;
  model?: string;
  request: MarketReviewRequest;
  runCommand?: CliRunner;
}): Promise<PolicyFinding & { modelId: string }> {
  const modelId = model ?? config.codexCliModel;
  const argv = buildCodexExecArgv({
    command: config.codexCliCommand,
    model: modelId,
    prompt: buildCliReviewPrompt(request),
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
  //
  // No `evidence` is passed, and that is the point: `codex exec --json` never
  // reports the URLs its hosted web search returned, so there is nothing here
  // that could tell a real source from an invented one. See the provider doc
  // in providers/codex-cli.ts. The default drops every claimed sourceCheck.
  return parseCliReviewFinding({
    modelId,
    raw: stdout,
    source: "codex CLI",
  });
}
