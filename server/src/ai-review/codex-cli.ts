import {
  buildCliReviewPrompt,
  cliExitError,
  parseCliReviewFinding,
  runWithBunSpawn,
  type CliRunner,
} from "./cli-support";
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
  const argv = [
    config.codexCliCommand,
    "exec",
    "--model",
    modelId,
    // The review never edits files or runs commands, so the sandbox stays
    // read-only. `codex exec` is already non-interactive and never prompts for
    // approval, so there is no approval flag to pass here — `--ask-for-approval`
    // belongs to the interactive CLI and is rejected by `exec`.
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    // Leaves no session transcript on the review host.
    "--ephemeral",
    // `--search` is TUI-only, so headless runs enable the hosted web-search
    // tool through a config override. The value is parsed as TOML, hence the
    // inner quotes.
    "-c",
    'web_search="live"',
    buildCliReviewPrompt(request),
  ];
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
  return parseCliReviewFinding({
    modelId,
    raw: stdout,
    source: "codex CLI",
  });
}
