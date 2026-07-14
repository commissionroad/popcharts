// In-process PGlite database for unit tests (ADR 0017 Track B): real
// Postgres-dialect SQL with zero setup. Pair with setDbForTesting() from
// src/db/client to point the ambient `db` handle at it for route-level
// tests, or pass the handle directly to persistence functions.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";

import type { db as productionDb } from "src/db/client";
import * as schema from "src/db/schema";

export interface PgliteDb {
  dbc: typeof productionDb;
  teardown: () => Promise<void>;
}

export async function createPgliteDb(): Promise<PgliteDb> {
  const client = new PGlite();
  // Same nominal-type gap as int-db.ts: query-compatible, nominally
  // distinct driver types.
  const dbc = drizzle(client, { schema }) as unknown as typeof productionDb;

  // pushSchema works on the PGlite driver (unlike postgres-js, where
  // int-db.ts uses generateMigration DDL instead).
  const { apply } = await pushSchema(
    schema,
    dbc as unknown as Parameters<typeof pushSchema>[1],
  );
  await apply();

  return {
    dbc,
    teardown: async () => {
      await client.close();
    },
  };
}
