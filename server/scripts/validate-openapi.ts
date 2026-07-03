import { readFileSync } from "node:fs";
import { join } from "node:path";

import SwaggerParser from "@apidevtools/swagger-parser";

/**
 * Validates the exported `server/generated/openapi.json` with the same parser
 * orval uses, so client generation failures surface here first with a real
 * error message instead of inside orval's output.
 */
const specPath = join(import.meta.dir, "../generated/openapi.json");

try {
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  await SwaggerParser.validate(spec);
  console.log("OpenAPI spec is valid.");
} catch (error) {
  console.error("OpenAPI validation failed:");
  console.error(error);
  process.exit(1);
}
