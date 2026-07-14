import { writeFileSync } from "node:fs";

import { readOptionalFile } from "./readOptionalFile.ts";

const APP_ENV_START = "# BEGIN POPCHARTS LOCAL DEV";
const APP_ENV_END = "# END POPCHARTS LOCAL DEV";
// protocol/scripts/deploy-devchain.ts maintains a sibling marker block in the
// same file, setting the same env keys for a standalone devchain deployment.
// dotenv resolves duplicate keys last-one-wins, so a leftover sibling block
// silently shadows the one written here and points the app at a dead
// deployment. Only one deployment may own the file at a time: each writer
// removes the other's block before writing its own.
const SIBLING_ENV_MARKERS: ReadonlyArray<readonly [string, string]> = [
  ["# BEGIN POPCHARTS DEVCHAIN", "# END POPCHARTS DEVCHAIN"],
];

/**
 * Writes the given env entries into a file between the
 * `# BEGIN POPCHARTS LOCAL DEV` / `# END POPCHARTS LOCAL DEV` markers,
 * replacing an existing block in place so hand-written content around it
 * survives regeneration. Sibling marker blocks written by other deploy tools
 * are removed so their duplicate keys cannot shadow this block. Creates the
 * file when it does not exist.
 */
export function writeEnvMarkerBlock(args: {
  readonly env: Record<string, string>;
  readonly filePath: string;
}): void {
  const existing = SIBLING_ENV_MARKERS.reduce(
    (content, [start, end]) => content.replace(markerBlockPattern(start, end), ""),
    readOptionalFile(args.filePath),
  );
  const block = [
    APP_ENV_START,
    ...Object.entries(args.env).map(([key, value]) => `${key}=${value}`),
    APP_ENV_END,
    "",
  ].join("\n");
  const pattern = markerBlockPattern(APP_ENV_START, APP_ENV_END);
  const next = pattern.test(existing)
    ? existing.replace(pattern, block)
    : `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${block}`;

  writeFileSync(args.filePath, next);
}

function markerBlockPattern(start: string, end: string): RegExp {
  return new RegExp(
    `${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`,
    "m",
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
