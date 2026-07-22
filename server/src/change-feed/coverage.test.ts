// Completeness guardrail for the live-updates change feed (repo ADR 0021).
//
// The removed capture trigger fired for every registered source automatically;
// with explicit recordLiveChange seams, "did we wire them all?" is no longer
// free. This test scans the write-seam sources for the `sourceTable` literals
// they record and asserts that set is EXACTLY the registry — so a newly
// registered source with no seam, or a seam naming an unregistered table, fails
// here rather than going silently dark. (The seams never write change_feed any
// other way, and the *_events records carry no `sourceTable` field, so the
// literal scan has no false positives.)
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

import { describe, expect, it } from "bun:test";

import { CHANGE_FEED_SOURCE_TABLES } from "src/change-feed/sources";

// Every process that persists a viewer-facing row: the indexer and the two
// job runners. A new writer of a registered source must be added here too.
const SEAM_DIRS = [
  "src/indexer",
  "src/ai-review-runner",
  "src/ai-resolution-runner",
];
const SOURCE_TABLE_LITERAL = /sourceTable:\s*"([a-z_]+)"/g;

function tsSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...tsSourceFiles(full));
    } else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

function recordedSourceTables(): string[] {
  const tables = new Set<string>();
  for (const dir of SEAM_DIRS) {
    for (const file of tsSourceFiles(dir)) {
      for (const match of readFileSync(file, "utf8").matchAll(
        SOURCE_TABLE_LITERAL,
      )) {
        tables.add(match[1]!);
      }
    }
  }
  return [...tables].sort();
}

describe("change feed seam coverage", () => {
  it("records a live change for exactly the registered sources", () => {
    expect(recordedSourceTables()).toEqual(
      [...CHANGE_FEED_SOURCE_TABLES].sort(),
    );
  });
});
