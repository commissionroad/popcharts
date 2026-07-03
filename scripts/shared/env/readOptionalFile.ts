import { readFileSync } from "node:fs";

/**
 * Reads a UTF-8 text file, returning the empty string when the file does not
 * exist. Any other filesystem error still throws — a permission problem must
 * not be silently treated as an empty file.
 */
export function readOptionalFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}
