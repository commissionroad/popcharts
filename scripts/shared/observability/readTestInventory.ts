import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * An inventory of the repository's tests, read from the working tree (ADR
 * 0017). Unlike the coverage and nightly panels — which show what CI last
 * pushed to ci-metrics — this reflects the code on disk right now, so the
 * dashboard can answer "what are we actually asserting, and where?".
 */
export interface TestFile {
  /** Repo-relative path, e.g. `app/src/features/portfolio/x.test.tsx`. */
  path: string;
  workspace: string;
  tier: TestTier;
  /** Suite and case titles in source order. */
  titles: TestTitle[];
  cases: number;
  /** Cases that are skipped / focused / todo in this file. */
  skipped: number;
  focused: number;
}

/**
 * A test's status, when it isn't running normally. `skip`/`todo` and an x-prefix
 * mean it never runs; `only` and an f-prefix FOCUS the file (siblings stop
 * running) and are the dangerous ones; `conditional` (skipIf/runIf) runs only
 * under a runtime condition.
 */
export type TestStatus = "skip" | "only" | "todo" | "conditional";

export interface TestTitle {
  kind: "suite" | "case";
  title: string;
  status?: TestStatus;
}

export type TestTier = "unit" | "integration" | "e2e" | "solidity";

export interface TestInventory {
  files: TestFile[];
  /** Case totals per tier, for the overview strip. */
  totals: { tier: TestTier; files: number; cases: number }[];
  totalFiles: number;
  totalCases: number;
  /** Repo-wide hygiene counts (cases only, not suites). */
  skipped: number;
  focused: number;
  todo: number;
  conditional: number;
}

/** Directories worth walking; everything else is skipped outright. */
const SCAN_ROOTS = ["app/src", "server/src", "protocol", "scripts/test"];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  "coverage-ts",
  ".next",
  "artifacts",
  "cache",
  "generated",
  "typechain-types",
]);

/**
 * Maps a repo-relative path to its workspace and tier, or null when the file
 * isn't a test. Order matters: `*.int.test.ts` must be classified as
 * integration before the plain `*.test.ts` unit rule sees it.
 */
function classify(rel: string): { workspace: string; tier: TestTier } | null {
  const path = rel.split(sep).join("/");
  if (path.startsWith("app/src/tests/e2e/") && path.endsWith(".spec.ts")) {
    return { workspace: "app", tier: "e2e" };
  }
  if (path.startsWith("app/src/") && /\.test\.tsx?$/.test(path)) {
    return { workspace: "app", tier: "unit" };
  }
  if (path.startsWith("server/src/") && path.endsWith(".int.test.ts")) {
    return { workspace: "server", tier: "integration" };
  }
  if (path.startsWith("server/src/") && path.endsWith(".test.ts")) {
    return { workspace: "server", tier: "unit" };
  }
  if (path.startsWith("protocol/") && path.endsWith(".t.sol")) {
    return { workspace: "protocol", tier: "solidity" };
  }
  if (path.startsWith("protocol/test/") && path.endsWith(".test.ts")) {
    return { workspace: "protocol", tier: "unit" };
  }
  if (path.startsWith("scripts/test/") && path.endsWith(".test.ts")) {
    return { workspace: "scripts", tier: "unit" };
  }
  return null;
}

/**
 * Matches a `describe(`/`it(`/`test(` call whose first argument is a string
 * literal, capturing the quote so the body can allow the *other* quote types
 * and backslash escapes without ending early. Modifier chains (`.each`,
 * `.skip`, `.only`) are allowed between the name and the parenthesis.
 * The optional `(...)` before the title paren catches the `describe.skipIf(cond)
 * ("title")` conditional form. Deliberately source-level: it lists what a reader
 * would see, and misses titles built at runtime (a template with `${}`, or
 * `it.each` rows).
 */
const TS_TITLE =
  /^[ \t]*(xdescribe|xit|xtest|fdescribe|fit|ftest|describe|it|test)((?:\.\w+)*)(?:\([^)]*\)(?=\s*\())?\s*\(\s*(['"`])((?:\\.|(?!\3)[^\\])*)\3/gm;

/** Classifies a test call's keyword + modifier chain into a non-normal status. */
function titleStatus(keyword: string, chain: string): TestStatus | undefined {
  if (keyword[0] === "x") return "skip";
  if (keyword[0] === "f" || /\.only\b/.test(chain)) return "only";
  if (/\.todo\b/.test(chain)) return "todo";
  if (/\.skipIf\b|\.runIf\b/.test(chain)) return "conditional";
  if (/\.skip\b/.test(chain)) return "skip";
  return undefined;
}

/** Solidity convention: forge/hardhat treat `test*`/`invariant*` as cases. */
const SOL_TITLE = /^\s*function\s+((?:test|invariant)\w*)/gm;

function extractTitles(source: string, isSolidity: boolean): TestFile["titles"] {
  const titles: TestFile["titles"] = [];
  if (isSolidity) {
    for (const match of source.matchAll(SOL_TITLE)) {
      titles.push({ kind: "case", title: match[1]! });
    }
    return titles;
  }
  for (const match of source.matchAll(TS_TITLE)) {
    const keyword = match[1]!;
    const status = titleStatus(keyword, match[2]!);
    titles.push({
      kind: /describe$/.test(keyword) ? "suite" : "case",
      title: match[4]!,
      ...(status ? { status } : {}),
    });
  }
  return titles;
}

function walk(dir: string, onFile: (absolute: string) => void): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // A scan root that doesn't exist in this checkout is not an error.
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const absolute = join(dir, entry);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(absolute).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) walk(absolute, onFile);
    else onFile(absolute);
  }
}

/**
 * Scans the working tree for test files and their titles. Cheap enough to run
 * per refresh (a few hundred files), and tolerant: an unreadable file is
 * skipped rather than failing the whole inventory.
 */
export function readTestInventory(repoRoot: string): TestInventory {
  const files: TestFile[] = [];
  for (const root of SCAN_ROOTS) {
    walk(join(repoRoot, root), (absolute) => {
      const rel = relative(repoRoot, absolute);
      const kind = classify(rel);
      if (!kind) return;
      let source: string;
      try {
        source = readFileSync(absolute, "utf8");
      } catch {
        return;
      }
      const titles = extractTitles(source, kind.tier === "solidity");
      const caseTitles = titles.filter((t) => t.kind === "case");
      files.push({
        path: rel.split(sep).join("/"),
        workspace: kind.workspace,
        tier: kind.tier,
        titles,
        cases: caseTitles.length,
        skipped: caseTitles.filter((t) => t.status === "skip").length,
        focused: caseTitles.filter((t) => t.status === "only").length,
      });
    });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // Counts statused titles at either level: a describe.skip / describe.skipIf
  // gates a whole block, so it counts like an it.skip.
  const countStatus = (all: TestFile[], status: TestStatus): number =>
    all.reduce(
      (sum, file) => sum + file.titles.filter((t) => t.status === status).length,
      0,
    );

  const tiers: TestTier[] = ["unit", "integration", "e2e", "solidity"];
  return {
    files,
    totals: tiers.map((tier) => {
      const forTier = files.filter((file) => file.tier === tier);
      return {
        tier,
        files: forTier.length,
        cases: forTier.reduce((sum, file) => sum + file.cases, 0),
      };
    }),
    totalFiles: files.length,
    totalCases: files.reduce((sum, file) => sum + file.cases, 0),
    skipped: countStatus(files, "skip"),
    focused: countStatus(files, "only"),
    todo: countStatus(files, "todo"),
    conditional: countStatus(files, "conditional"),
  };
}
