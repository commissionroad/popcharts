/**
 * Parses a generated `KEY=VALUE` env file into a plain record. Blank lines,
 * `#` comments, and lines without a non-empty key before `=` are skipped;
 * later keys win. No quote or escape handling — the local orchestrators only
 * write plain values.
 *
 * This is the only env-parse body in the repo; {@link readEnvFile} is the
 * from-disk wrapper. Both are reachable from the server workspace by relative
 * path, so keep them free of everything but node builtins — server cannot
 * reach scripts/ through node_modules.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    env[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }

  return env;
}
