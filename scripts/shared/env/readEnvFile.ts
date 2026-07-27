import { readFileSync } from "node:fs";

import { parseEnvFile } from "./parseEnvFile.ts";

/**
 * Reads a generated `KEY=VALUE` env file from disk. See {@link parseEnvFile}
 * for the accepted format.
 */
export function readEnvFile(path: string): Record<string, string> {
  return parseEnvFile(readFileSync(path, "utf8"));
}
