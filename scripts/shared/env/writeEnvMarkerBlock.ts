import { writeFileSync } from "node:fs";

import { readOptionalFile } from "./readOptionalFile.ts";

const APP_ENV_START = "# BEGIN POPCHARTS LOCAL DEV";
const APP_ENV_END = "# END POPCHARTS LOCAL DEV";

/**
 * Writes the given env entries into a file between the
 * `# BEGIN POPCHARTS LOCAL DEV` / `# END POPCHARTS LOCAL DEV` markers,
 * replacing an existing block in place so hand-written content around it
 * survives regeneration. Creates the file when it does not exist.
 */
export function writeEnvMarkerBlock(args: {
  readonly env: Record<string, string>;
  readonly filePath: string;
}): void {
  const existing = readOptionalFile(args.filePath);
  const block = [
    APP_ENV_START,
    ...Object.entries(args.env).map(([key, value]) => `${key}=${value}`),
    APP_ENV_END,
    "",
  ].join("\n");
  const pattern = new RegExp(
    `${escapeRegExp(APP_ENV_START)}[\\s\\S]*?${escapeRegExp(APP_ENV_END)}\\n?`,
    "m",
  );
  const next = pattern.test(existing)
    ? existing.replace(pattern, block)
    : `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${block}`;

  writeFileSync(args.filePath, next);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
