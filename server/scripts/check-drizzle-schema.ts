import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * Fails (exit 1) when the drizzle migrations committed under `drizzle/` are
 * stale relative to the TypeScript schema in `src/db/schema/` — the schema
 * counterpart of `openapi:check`.
 *
 * Neither the unit suite nor the integration suite exercises drizzle-kit, so
 * without this a schema edit that needs a migration lands green and only
 * surfaces when someone runs `db:generate` by hand, or when a deploy applies
 * migrations that no longer match the code.
 *
 * How it works: `drizzle-kit generate` is the only way to ask drizzle whether
 * the schema and the snapshots agree — it has no `--check` flag of its own,
 * and it writes a migration when they differ. So this runs it, treats any
 * difference under `drizzle/` as the failure signal, prints the SQL it wanted
 * to write, and restores the directory to exactly its prior contents.
 *
 * Running the check never leaves the working tree dirty. That holds even when
 * generate fails partway through, which is why the restore sits in a `finally`
 * and why the exit code is returned rather than raised with `process.exit`
 * inside the block — `process.exit` skips `finally`.
 *
 * `generate` compares the schema against the newest snapshot file and never
 * connects to a database, so this needs no Postgres — verified by running it
 * against an unreachable DATABASE_URL.
 */

const MIGRATIONS_DIR = join(import.meta.dir, "../drizzle");

/** Every file under `drizzle/`, keyed by relative path, with its exact bytes. */
function readTree(directory: string): Map<string, Buffer> {
  const tree = new Map<string, Buffer>();

  for (const entry of readdirSync(directory, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) {
      continue;
    }

    const absolute = join(entry.parentPath, entry.name);
    tree.set(relative(directory, absolute), readFileSync(absolute));
  }

  return tree;
}

/** Every subdirectory under `drizzle/`, so restore can drop ones generate added. */
function readDirectories(directory: string): Set<string> {
  const directories = new Set<string>();

  for (const entry of readdirSync(directory, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isDirectory()) {
      directories.add(relative(directory, join(entry.parentPath, entry.name)));
    }
  }

  return directories;
}

/**
 * Paths that differ between two trees, in either direction — added, modified,
 * or removed. Checking both directions matters: a generator that deletes a
 * snapshot is just as much a staleness signal as one that writes a migration,
 * and walking only the post-generation tree would score that as "up to date".
 */
function changedPaths(
  before: Map<string, Buffer>,
  after: Map<string, Buffer>,
): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);

  return [...paths]
    .filter((path) => {
      const original = before.get(path);
      const current = after.get(path);

      if (original === undefined || current === undefined) {
        return true;
      }

      return !original.equals(current);
    })
    .sort();
}

/**
 * Puts `drizzle/` back exactly as it was: drops what generate added, rewrites
 * what it modified, recreates anything it removed, and removes directories it
 * created (deepest first, so nested ones empty out before their parents).
 */
function restoreTree(
  directory: string,
  before: Map<string, Buffer>,
  beforeDirectories: Set<string>,
) {
  const after = readTree(directory);

  for (const [path, contents] of after) {
    const original = before.get(path);

    if (original === undefined) {
      rmSync(join(directory, path));
    } else if (!original.equals(contents)) {
      writeFileSync(join(directory, path), original);
    }
  }

  for (const [path, original] of before) {
    if (!after.has(path)) {
      const absolute = join(directory, path);

      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, original);
    }
  }

  const added = [...readDirectories(directory)]
    .filter((path) => !beforeDirectories.has(path))
    .sort((a, b) => b.length - a.length);

  for (const path of added) {
    rmdirSync(join(directory, path));
  }
}

/** Prints what generate wanted to change, with the SQL of any new migration. */
function report(
  changed: string[],
  before: Map<string, Buffer>,
  after: Map<string, Buffer>,
) {
  console.error(
    "The committed drizzle migrations are stale — the schema in src/db/schema/ needs a migration.",
  );
  console.error("`drizzle-kit generate` wanted to change:\n");

  for (const path of changed) {
    const contents = after.get(path);

    if (contents === undefined) {
      console.error(`  ${path} (removed)`);
      continue;
    }

    console.error(`  ${path}${before.has(path) ? " (modified)" : ""}`);

    if (path.endsWith(".sql")) {
      console.error(
        `${contents
          .toString("utf8")
          .trimEnd()
          .split("\n")
          .map((line) => `    ${line}`)
          .join("\n")}\n`,
      );
    }
  }

  console.error("Run `bun run db:generate` and commit the result.");
}

const before = readTree(MIGRATIONS_DIR);
const beforeDirectories = readDirectories(MIGRATIONS_DIR);
let exitCode = 0;

try {
  const generate = spawnSync("drizzle-kit", ["generate"], {
    cwd: join(import.meta.dir, ".."),
    encoding: "utf8",
    shell: false,
  });

  if (generate.status !== 0) {
    console.error(generate.stdout ?? "");
    console.error(generate.stderr ?? "");
    console.error("`drizzle-kit generate` failed; see the output above.");
    exitCode = 1;
  } else {
    const after = readTree(MIGRATIONS_DIR);
    const changed = changedPaths(before, after);

    if (changed.length === 0) {
      console.log("Drizzle migrations are up to date.");
    } else {
      report(changed, before, after);
      exitCode = 1;
    }
  }
} finally {
  restoreTree(MIGRATIONS_DIR, before, beforeDirectories);
}

process.exit(exitCode);
