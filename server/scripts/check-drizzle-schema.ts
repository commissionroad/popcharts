import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

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
 * and it writes a migration when they differ. So this runs it, treats any new
 * or modified file under `drizzle/` as the failure signal, prints the SQL it
 * wanted to write, and then restores the directory to exactly its prior
 * contents. Running the check never leaves the working tree dirty, whether it
 * passes or fails.
 *
 * `generate` compares the schema against the newest snapshot file and never
 * connects to a database, so this needs no Postgres — verified by running it
 * against an unreachable DATABASE_URL.
 */

const MIGRATIONS_DIR = join(import.meta.dir, "../drizzle");

/** Every file under `drizzle/`, keyed by path, with its exact bytes. */
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

/** Puts `drizzle/` back exactly as it was, dropping anything generate added. */
function restoreTree(directory: string, before: Map<string, Buffer>) {
  for (const [path, contents] of readTree(directory)) {
    const original = before.get(path);

    if (original === undefined) {
      rmSync(join(directory, path));
    } else if (!original.equals(contents)) {
      writeFileSync(join(directory, path), original);
    }
  }
}

const before = readTree(MIGRATIONS_DIR);

const generate = spawnSync("drizzle-kit", ["generate"], {
  cwd: join(import.meta.dir, ".."),
  encoding: "utf8",
  shell: false,
});

if (generate.status !== 0) {
  console.error(generate.stdout ?? "");
  console.error(generate.stderr ?? "");
  console.error("`drizzle-kit generate` failed; see the output above.");
  process.exit(1);
}

const after = readTree(MIGRATIONS_DIR);
const changed = [...after.keys()].filter((path) => {
  const original = before.get(path);

  return original === undefined || !original.equals(after.get(path)!);
});

if (changed.length === 0) {
  console.log("Drizzle migrations are up to date.");
  process.exit(0);
}

console.error(
  "The committed drizzle migrations are stale — the schema in src/db/schema/ needs a migration.",
);
console.error("`drizzle-kit generate` wanted to write:\n");

for (const path of changed.sort()) {
  console.error(`  ${path}`);

  if (path.endsWith(".sql")) {
    console.error(
      `${after
        .get(path)!
        .toString("utf8")
        .trimEnd()
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n")}\n`,
    );
  }
}

console.error("Run `bun run db:generate` and commit the result.");

restoreTree(MIGRATIONS_DIR, before);

process.exit(1);
