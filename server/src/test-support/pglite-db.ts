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
 * This makes the failure visible; it does not remove it. The rejection being
 * swallowed was PGlite running out of memory (`RangeError: Out of memory` in
 * `expandFileStorage`) — each instance costs ~1.2-2GB RSS and the suite boots
 * roughly 25 of them. That now fails the owning test with a real stack instead
 * of killing the run. Cutting the instance count is the actual cure.
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

  return {
    dbc,
    teardown: async () => {
      await client.close();
    },
  };
}
