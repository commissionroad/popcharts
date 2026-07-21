import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

// Any quoted string mentioning scripts/, not just import-shaped ones: a
// specifier-context pattern (`from "..."`) misses side-effect imports
// (`import "../scripts/x.js"`), require()/createRequire, and vi/jiti-style
// dynamic loaders. Intentionally coarse — a false positive in a quoted log
// message is a cheap review nudge, a false negative is a silent boundary
// hole.
const quotedScriptsPathPattern = /["']([^"'\n]*scripts\/[^"'\n]*)["']/g;

function readExportsMap(): Record<string, string> {
  const packageJson = JSON.parse(readFileSync(join(protocolRoot, "package.json"), "utf8")) as {
    exports: Record<string, string>;
  };
  return packageJson.exports;
}

describe("protocol SDK surface guard (ADR 0017 Track G)", function () {
  it("src/ never references scripts/ — the SDK cannot depend on ops tooling", function () {
    const offenders: string[] = [];
    for (const file of collectTypeScriptFiles(srcRoot)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(quotedScriptsPathPattern)) {
        offenders.push(`${relative(protocolRoot, file)} -> ${match[1]}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `protocol/src must not reach into protocol/scripts. The public SDK lives in src/; scripts import from src, never the reverse (ADR 0017 Track G). Offending references:\n${offenders.join("\n")}`,
    );
  });

  it("the exports map is exactly the reviewed surface, every target under src/ and on disk", function () {
    // The full key-to-target map is pinned, not just key names or a ./src/
    // prefix: retargeting a subpath is as surface-changing as adding one.
    // Growing or repointing the surface is fine — do it here, in the same
    // PR, so it is a reviewed decision rather than a barrel side effect.
    const exportsMap = readExportsMap();
    assert.deepEqual(exportsMap, {
      ".": "./src/index.ts",
      "./market-side": "./src/market-side.ts",
      "./pregrad-manager": "./src/generated/pregrad-manager.ts",
      "./postgrad-venue": "./src/generated/postgrad-venue.ts",
      "./mock-collateral": "./src/generated/mock-collateral.ts",
      "./complete-set-price-policy": "./src/price/completeSetPricePolicy.ts",
      "./tick-to-sqrt-price": "./src/price/tickToSqrtPriceX96.ts",
    });
    for (const [subpath, target] of Object.entries(exportsMap)) {
      assert.ok(
        existsSync(join(protocolRoot, target)),
        `exports["${subpath}"] targets ${target}, which does not exist on disk`,
      );
    }
  });
});
