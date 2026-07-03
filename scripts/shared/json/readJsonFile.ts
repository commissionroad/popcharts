import { readFileSync } from "node:fs";

/** Reads and parses a JSON file from disk. */
export function readJsonFile<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
