/**
 * The single definition of how this repo invokes `codex exec`, shared by the
 * AI review and AI resolution providers.
 *
 * This list is verified against the real CLI, and that matters more than it
 * looks: an earlier revision passed `--ask-for-approval never`, which reads as
 * reasonable but which `codex exec` refuses to parse, so every invocation
 * failed. A unit test asserting the flag was *present* confirmed the mistake
 * rather than catching it. Keeping one definition means one place to re-verify
 * when the CLI changes, and one place for both services' tests to pin.
 *
 * Verified against codex-cli 0.144.4.
 */
export function buildCodexExecArgv({
  command,
  model,
  prompt,
}: {
  command: string;
  model: string;
  prompt: string;
}): string[] {
  return [
    command,
    "exec",
    "--model",
    model,
    // Neither service edits files or runs commands, so the sandbox stays
    // read-only. `codex exec` is already non-interactive and never prompts for
    // approval, so there is no approval flag to pass — `--ask-for-approval`
    // belongs to the interactive CLI and is rejected here.
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    // Leaves no session transcript on the host.
    "--ephemeral",
    // `--search` is TUI-only, so headless runs enable the hosted web-search
    // tool through a config override. The value is parsed as TOML, hence the
    // inner quotes.
    "-c",
    'web_search="live"',
    prompt,
  ];
}
