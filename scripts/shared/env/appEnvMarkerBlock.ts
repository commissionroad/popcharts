/**
 * The single marker block Pop Charts dev tooling owns inside the app's
 * .env.development.local. Historically each deploy tool wrote its own block
 * (`POPCHARTS LOCAL DEV` from scripts/local-dev.ts, `POPCHARTS DEVCHAIN` from
 * protocol/scripts/deploy-devchain.ts) with overlapping keys; dotenv resolves
 * duplicate keys last-one-wins, so a stale block from one tool silently
 * shadowed the fresh block of the other and pointed the app at a dead
 * deployment. All writers now share this one marker, which makes replacing
 * the block in place naturally exclusive: the last deployment to run owns
 * the file.
 *
 * This module is imported from both the repo scripts workspace (`.ts`
 * specifier under node --experimental-strip-types) and protocol scripts
 * (`.js` specifier under the hardhat loader), so it must stay
 * dependency-free.
 */

export const APP_ENV_MARKER_START = "# BEGIN POPCHARTS APP ENV";
export const APP_ENV_MARKER_END = "# END POPCHARTS APP ENV";

// Marker pairs written by earlier versions of the dev tooling. Stripped on
// every write so existing dev machines migrate to the unified block the
// first time any deploy tool runs; deletable once no checkout still has an
// old block.
const LEGACY_ENV_MARKERS: ReadonlyArray<readonly [string, string]> = [
  ["# BEGIN POPCHARTS LOCAL DEV", "# END POPCHARTS LOCAL DEV"],
  ["# BEGIN POPCHARTS DEVCHAIN", "# END POPCHARTS DEVCHAIN"],
];

/**
 * Returns the env file content with the Pop Charts marker block replaced in
 * place (or appended when absent), preserving hand-written content around
 * it. Legacy marker blocks are removed so their duplicate keys cannot shadow
 * the unified block.
 */
export function updateAppEnvMarkerBlock(args: {
  readonly entries: readonly string[];
  readonly existing: string;
}): string {
  const existing = LEGACY_ENV_MARKERS.reduce(
    (content, [start, end]) => content.replace(markerBlockPattern(start, end), ""),
    args.existing,
  );
  const block = [APP_ENV_MARKER_START, ...args.entries, APP_ENV_MARKER_END, ""].join("\n");
  const pattern = markerBlockPattern(APP_ENV_MARKER_START, APP_ENV_MARKER_END);

  return pattern.test(existing)
    ? existing.replace(pattern, block)
    : `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${block}`;
}

/**
 * Matches one marker block: the start line through the nearest end line —
 * the lazy `[\s\S]*?` spans newlines without needing the dotAll flag — plus
 * the block's trailing newline, so removing a block does not leave a blank
 * line behind. Marker text is escaped to match literally.
 */
function markerBlockPattern(start: string, end: string): RegExp {
  return new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`);
}

/** Escapes regex metacharacters so `value` matches as a literal string. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
