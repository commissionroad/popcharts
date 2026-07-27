/**
 * Parses a generated `KEY=VALUE` env file into a plain record. Blank lines,
 * `#` comments, and lines without a non-empty key before `=` are skipped;
 * later keys win. No quote or escape handling — the local orchestrators only
 * write plain values.
 *
 * This is the only env-parse body in the repo. Keep it dependency-free (no
 * imports at all): the server workspace imports it by relative path because it
 * cannot reach scripts/ through node_modules — see the import sites in
 * server/scripts/bot-trade.ts, server/scripts/bot-trade-postgrad.ts, and
 * server/src/lifecycle-nightly/env.ts.
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
