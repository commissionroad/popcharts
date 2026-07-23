import { readFileSync } from "node:fs";

/**
 * Reads a file as UTF-8 text, returning null when the path is unset or the file
 * is missing. The ci-metrics updaters use this to treat an absent datastore
 * file (first run, or a report that hasn't landed yet) as empty rather than an
 * error.
 */
export function readTextOrNull(path: string | undefined): string | null {
  if (!path) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
