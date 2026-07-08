import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Regression guardrail for the "never surface raw errors to users" contract
 * (see docs/error-handling-ux-prd.md). Raw error text must never be rendered or
 * stored as user-facing state directly — it has to flow through
 * `presentError` / `getErrorMessage`, which log the real error and return only
 * curated copy.
 *
 * This scan flags the exact leak shapes that had accumulated across the app: a
 * bare `error.message` / `err.message` / `.shortMessage` value (as opposed to
 * `error.message.includes(...)`, which merely *inspects* the message inside a
 * matcher), and `String(error)`. If this test fails, route the error through
 * `presentError` instead of reading its message directly.
 */
const SRC_ROOT = join(import.meta.dirname, "..");

// The only place allowed to read a raw error message as a value: the shared
// error utility itself, which turns it into safe copy.
const ALLOWED_FILES = new Set(["lib/error-handling.ts"]);

// Bare `.message` / `.shortMessage` value use — NOT followed by another `.`,
// which would make it an inspection like `.message.includes(...)`.
const RAW_VALUE_PATTERNS = [
  /\b(?:error|err)\.message\b(?!\s*\.)/,
  /\.shortMessage\b(?!\s*\.)/,
  /\bString\(\s*(?:error|err)\s*\)/,
];

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (!/\.(ts|tsx)$/.test(entry.name)) {
      continue;
    }

    if (/\.test\.(ts|tsx)$/.test(entry.name) || entry.name.endsWith(".d.ts")) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

describe("no raw error render guardrail", () => {
  it("no product source reads a raw error message as a display value", () => {
    const offenders: string[] = [];

    for (const file of collectSourceFiles(SRC_ROOT)) {
      const relPath = relative(SRC_ROOT, file);

      if (ALLOWED_FILES.has(relPath)) {
        continue;
      }

      const lines = readFileSync(file, "utf8").split("\n");

      lines.forEach((line, index) => {
        if (RAW_VALUE_PATTERNS.some((pattern) => pattern.test(line))) {
          offenders.push(`${relPath}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
