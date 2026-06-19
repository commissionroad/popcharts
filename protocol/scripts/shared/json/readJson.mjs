import { readFile } from "node:fs/promises";

/**
 * Reads and parses a JSON file from disk.
 */
export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
