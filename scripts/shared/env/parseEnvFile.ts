/** Parses generated KEY=VALUE env files (comments and blank lines ignored). */
export function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
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
