import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { app } from "../src/api/index";

/**
 * Exports the API's OpenAPI spec to `server/generated/openapi.json`.
 *
 * The raw spec Elysia serves is not strict OpenAPI 3.0: TypeBox leaves `$id`
 * markers on component schemas, nested `t.Ref` schemas emit bare
 * `$ref: "Name"` pointers, and `t.Literal` emits JSON Schema `const`, which
 * OpenAPI 3.0 does not allow. This script normalizes all of these so downstream
 * generators (orval in `app/`) consume named `components.schemas` entries and
 * produce human-named client models instead of synthesized ones.
 *
 * Run with `--check` to fail (exit 1) when the committed spec is stale
 * instead of rewriting it.
 */

const OUTPUT_PATH = join(import.meta.dir, "../generated/openapi.json");

/** JSON value shape used while walking the spec. */
type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Normalizes one node of the spec tree: drops TypeBox `$id` artifacts,
 * expands bare `$ref` names to `#/components/schemas/...` pointers, and
 * converts `anyOf`-with-null unions to OpenAPI 3.0 `nullable` form.
 */
function cleanNode(node: JsonValue): JsonValue {
  if (node === null || typeof node !== "object") {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map(cleanNode);
  }

  const cleaned: { [key: string]: JsonValue } = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$id") {
      continue;
    }
    if (
      key === "$ref" &&
      typeof value === "string" &&
      !value.startsWith("#/")
    ) {
      cleaned[key] = `#/components/schemas/${value}`;
      continue;
    }
    cleaned[key] = cleanNode(value);
  }

  if ("const" in cleaned) {
    cleaned.enum = [cleaned.const];
    delete cleaned.const;
  }

  if (Array.isArray(cleaned.anyOf)) {
    const isNullMember = (member: JsonValue) =>
      typeof member === "object" &&
      member !== null &&
      !Array.isArray(member) &&
      member.type === "null";
    const nonNull = cleaned.anyOf.filter((member) => !isNullMember(member));
    if (nonNull.length === 1 && nonNull.length < cleaned.anyOf.length) {
      const [only] = nonNull;
      if (typeof only === "object" && only !== null && !Array.isArray(only)) {
        delete cleaned.anyOf;
        Object.assign(cleaned, only, { nullable: true });
      }
    }
  }

  return cleaned;
}

const response = await app.handle(new Request("http://localhost/openapi/json"));
if (!response.ok) {
  console.error(`Failed to read OpenAPI spec from app: ${response.status}`);
  process.exit(1);
}

const spec = cleanNode((await response.json()) as JsonValue);
const serialized = `${JSON.stringify(spec, null, 2)}\n`;

if (process.argv.includes("--check")) {
  let existing: string | undefined;
  try {
    existing = readFileSync(OUTPUT_PATH, "utf8");
  } catch {
    existing = undefined;
  }
  if (existing !== serialized) {
    console.error(
      `${OUTPUT_PATH} is stale. Run \`bun run openapi:generate\` and commit the result.`,
    );
    process.exit(1);
  }
  console.log("OpenAPI spec is up to date.");
  process.exit(0);
}

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, serialized);
console.log(`OpenAPI spec written to ${OUTPUT_PATH}`);
process.exit(0);
