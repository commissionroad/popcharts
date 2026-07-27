import { readFileSync } from "node:fs";

/**
 * Reads a generated `KEY=VALUE` env file into a plain record. Blank lines,
 * `#` comments, and lines without a non-empty key before `=` are skipped;
 * later keys win. No quote or escape handling — the local orchestrators only
 * write plain values.
 *
 * This is the only env-parse body in the repo. It is also imported from the
 * server workspace by relative path (server/scripts/bot-trade*.ts,
 * server/src/lifecycle-nightly/env.ts), which cannot reach scripts/ through
 * node_modules — so keep this file free of everything but node builtins.
 */
export function readEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
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
