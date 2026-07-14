import { writeFileSync } from "node:fs";

import { updateAppEnvMarkerBlock } from "./appEnvMarkerBlock.ts";
import { readOptionalFile } from "./readOptionalFile.ts";

/**
 * Writes the given env entries into the file's Pop Charts marker block —
 * see appEnvMarkerBlock.ts for the block-exclusivity rules — creating the
 * file when it does not exist.
 */
export function writeEnvMarkerBlock(args: {
  readonly env: Record<string, string>;
  readonly filePath: string;
}): void {
  const next = updateAppEnvMarkerBlock({
    entries: Object.entries(args.env).map(([key, value]) => `${key}=${value}`),
    existing: readOptionalFile(args.filePath),
  });

  writeFileSync(args.filePath, next);
}
