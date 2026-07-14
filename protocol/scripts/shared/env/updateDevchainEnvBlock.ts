const APP_ENV_START = "# BEGIN POPCHARTS DEVCHAIN";
const APP_ENV_END = "# END POPCHARTS DEVCHAIN";
// scripts/shared/env/writeEnvMarkerBlock.ts (the local-dev stack) maintains a
// sibling marker block in the same file, setting the same env keys. dotenv
// resolves duplicate keys last-one-wins, so a leftover sibling block silently
// shadows the one written here and points the app at a dead deployment. Only
// one deployment may own the file at a time: each writer removes the other's
// block before writing its own.
const SIBLING_ENV_MARKERS: ReadonlyArray<readonly [string, string]> = [
  ["# BEGIN POPCHARTS LOCAL DEV", "# END POPCHARTS LOCAL DEV"],
];

/**
 * Returns the app env file content with the devchain marker block replaced in
 * place (or appended when absent) so hand-written content around it survives
 * redeploys. Sibling marker blocks written by other deploy tools are removed
 * so their duplicate keys cannot shadow this block.
 */
export function updateDevchainEnvBlock(args: {
  readonly entries: readonly string[];
  readonly existing: string;
}): string {
  const existing = SIBLING_ENV_MARKERS.reduce(
    (content, [start, end]) => content.replace(markerBlockPattern(start, end), ""),
    args.existing,
  );
  const block = [APP_ENV_START, ...args.entries, APP_ENV_END, ""].join("\n");
  const pattern = markerBlockPattern(APP_ENV_START, APP_ENV_END);

  return pattern.test(existing)
    ? existing.replace(pattern, block)
    : `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${block}`;
}

function markerBlockPattern(start: string, end: string): RegExp {
  return new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, "m");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
