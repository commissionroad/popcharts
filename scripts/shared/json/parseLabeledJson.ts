/**
 * Extracts and parses the JSON payload from a stable `LABEL={json}` stdout
 * line. Helper scripts emit exactly one such line so orchestrators can ignore
 * package-manager banners and tool logs around it. Throws when the label is
 * absent — a missing marker means the helper script's contract changed.
 */
export function parseLabeledJson<T = unknown>(
  stdout: string,
  label: string,
): T {
  const prefix = `${label}=`;
  const line = stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(prefix));

  if (!line) {
    throw new Error(`Could not find ${label} in command output.`);
  }

  return JSON.parse(line.slice(prefix.length)) as T;
}
