import { readFileSync } from "node:fs";

import { parseEnvFile } from "./parseEnvFile.ts";

/**
 * Reads a generated `KEY=VALUE` env file from disk. See {@link parseEnvFile}
 * for the accepted format. Also imported from the server workspace by relative
 * path (server/scripts/bot-trade*.ts, server/src/lifecycle-nightly/env.ts).
 */
export function readEnvFile(path: string): Record<string, string> {
  return parseEnvFile(readFileSync(path, "utf8"));
}
