import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Reads and parses a JSON file from disk.
 */
export async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

/**
 * Writes pretty-printed JSON, creating the parent directory when needed.
 */
export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
