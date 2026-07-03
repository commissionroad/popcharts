import { readFileSync } from "node:fs";

/**
 * Parses a generated `KEY=VALUE` env file into a plain record. Blank lines,
 * `#` comments, and lines without `=` are skipped; later keys win. No quote
 * or escape handling — the local orchestrators only write plain values.
 */
export function readEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  const text = readFileSync(path, "utf8");

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    env[key] = value;
  }

  return env;
}
