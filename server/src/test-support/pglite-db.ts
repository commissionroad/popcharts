// In-process PGlite database for unit tests (ADR 0017 Track B): real
// Postgres-dialect SQL with zero setup. Pair with setDbForTesting() from
// src/db/client to point the ambient `db` handle at it for route-level
// tests, or pass the handle directly to persistence functions.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";

import type { db as productionDb } from "src/db/client";
import * as schema from "src/db/schema";

export interface PgliteDb {
  dbc: typeof productionDb;
  /**
   * Empties every table and restarts its sequences, so one instance can serve a
   * whole file's tests with the clean slate a fresh database would give.
   *
   * Prefer `beforeAll(createPgliteDb)` + `beforeEach(reset)` over booting an
   * instance per test: each PGlite costs ~1.2-2GB of resident memory that
   * `close()` does not hand back promptly, and a suite that boots enough of
   * them runs the allocator out of room (`RangeError: Out of memory` inside
   * PGlite's `expandFileStorage`). Resetting is also far faster than booting.
   */
  reset: () => Promise<void>;
  teardown: () => Promise<void>;
}

/**
 * The DDL for a fresh database, diffed once per process.
 *
 * Deliberately NOT drizzle-kit's `pushSchema`: that introspects the live
 * database behind a progress spinner, and drizzle-kit's spinner wrapper
 * (`renderWithTask`) answers *any* rejection from the wrapped task by calling
 * `process.exit(1)`. The error never reaches the caller, so a `try` around
 * `pushSchema` cannot catch it — a transient introspection failure instead
 * killed the whole `bun test` process mid-run, silently: no failing test, no
 * stack, and drizzle-kit's own message erased by the next spinner repaint.
 * `generateMigration` diffs an empty snapshot against the schema offline —
 * no database contact, no spinner, no exit path — which is what int-db.ts
 * already does. It is also cheaper: one diff here instead of a fresh
 * introspection for every instance the suite boots.
 *
 * The rejection being swallowed was PGlite running out of memory (`RangeError:
 * Out of memory` in `expandFileStorage`), which is why callers should share one
 * instance per file and {@link PgliteDb.reset} between tests rather than boot
 * one per test.
 */
let schemaDdl: Promise<string[]> | null = null;

function freshDatabaseDdl(): Promise<string[]> {
  schemaDdl ??= generateMigration(
    generateDrizzleJson({}),
    generateDrizzleJson(schema),
  );
  return schemaDdl;
}

export async function createPgliteDb(): Promise<PgliteDb> {
  const client = new PGlite();
  // Same nominal-type gap as int-db.ts: query-compatible, nominally
  // distinct driver types.
  const dbc = drizzle(client, { schema }) as unknown as typeof productionDb;

  for (const statement of await freshDatabaseDdl()) {
    await client.exec(statement);
  }

  // Read back rather than deriving from the schema module, so a table created
  // by the DDL but not exported from `schema` still gets emptied by reset().
  const { rows } = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  const tableList = rows.map((row) => `"${row.tablename}"`).join(", ");

  return {
    dbc,
    reset: async () => {
      if (tableList.length === 0) {
        return;
      }
      // CASCADE because the tables are foreign-keyed to each other; RESTART
      // IDENTITY so sequence-assigned ids start from 1 as they would in a
      // freshly created database.
      await client.exec(`truncate table ${tableList} restart identity cascade`);
    },
    teardown: async () => {
      await client.close();
    },
  };
}
