import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const protocolRoot = fileURLToPath(new URL("../..", import.meta.url));
const srcRoot = join(protocolRoot, "src");

function collectTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(fullPath));
    } else if (entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

// Static import/export-from/dynamic-import specifiers. Intentionally coarse:
// a false positive in a comment is a cheap review nudge, a false negative is
// a silent boundary hole.
const specifierPattern = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;

describe("protocol SDK surface guard (ADR 0017 Track G)", function () {
  it("src/ never imports from scripts/ — the SDK cannot depend on ops tooling", function () {
    const offenders: string[] = [];
    for (const file of collectTypeScriptFiles(srcRoot)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(specifierPattern)) {
        const specifier = match[1];
        if (specifier.includes("scripts/")) {
          offenders.push(`${relative(protocolRoot, file)} -> ${specifier}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `protocol/src must not reach into protocol/scripts. The public SDK lives in src/; scripts import from src, never the reverse (ADR 0017 Track G). Offending imports:\n${offenders.join("\n")}`,
    );
  });

  it("every exports-map target resolves inside src/", function () {
    const packageJson = JSON.parse(readFileSync(join(protocolRoot, "package.json"), "utf8")) as {
      exports: Record<string, string>;
    };
    for (const [subpath, target] of Object.entries(packageJson.exports)) {
      assert.ok(
        target.startsWith("./src/"),
        `exports["${subpath}"] targets ${target}; the consumer allowlist must be implemented entirely under src/`,
      );
    }
  });

  it("the exports-map subpath set only grows deliberately", function () {
    const packageJson = JSON.parse(readFileSync(join(protocolRoot, "package.json"), "utf8")) as {
      exports: Record<string, string>;
    };
    // Growing the public surface is fine — do it here, in the same PR, so
    // the addition is a reviewed decision rather than a barrel side effect.
    assert.deepEqual(Object.keys(packageJson.exports).sort(), [
      ".",
      "./complete-set-price-policy",
      "./market-side",
      "./postgrad-venue",
      "./pregrad-manager",
      "./tick-to-sqrt-price",
    ]);
  });
});
