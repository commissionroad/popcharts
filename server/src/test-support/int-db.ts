// Integration-test database provisioning (ADR 0017 Track B).
//
// Convention: `*.int.test.ts` files gate themselves with
// `describe.skipIf(!INT_DB_URL)` so the plain unit run (`bun test`) skips
// them with no Postgres and no Docker. `bun run test:integration` sets
// POPCHARTS_INT_DB_URL — in CI the job's service container, locally e.g.
// the docker-compose Postgres:
//   POPCHARTS_INT_DB_URL=postgresql://postgres:postgres@localhost:5433/postgres
//
// Each createIntDb() call provisions a throwaway database with a random
// name and applies the drizzle schema, so integration tests can never
// touch a long-lived dev database and never see each other's state.
import { randomBytes } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import postgres from "postgres";

import type { db as productionDb } from "src/db/client";
import * as schema from "src/db/schema";

export const INT_DB_URL = process.env.POPCHARTS_INT_DB_URL;

export interface IntDb {
  dbc: typeof productionDb;
  teardown: () => Promise<void>;
}

export async function createIntDb(): Promise<IntDb> {
  if (!INT_DB_URL) {
    throw new Error(
      "POPCHARTS_INT_DB_URL is not set; integration tests should be skipped via describe.skipIf(!INT_DB_URL).",
    );
  }

  const dbName = `popcharts_int_${randomBytes(6).toString("hex")}`;
  const admin = postgres(INT_DB_URL, { max: 1 });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);

  const url = new URL(INT_DB_URL);
  url.pathname = `/${dbName}`;
  const client = postgres(url.toString(), { max: 4, onnotice: () => {} });
  // Same nominal-type gap as the PGlite spike: the executor is
  // query-compatible with `typeof db`. First-class injection is a later
  // Track B item.
  const dbc = drizzle(client, { schema }) as unknown as typeof productionDb;

  // pushSchema introspects via the driver and is incompatible with
  // postgres-js result shapes; generateMigration emits plain DDL instead
  // (empty snapshot → full schema), which runs on any driver.
  const statements = await generateMigration(
    generateDrizzleJson({}),
    generateDrizzleJson(schema),
  );
  for (const statement of statements) {
    await client.unsafe(statement);
  }

  return {
    dbc,
    teardown: async () => {
      await client.end({ timeout: 5 });
      await admin.unsafe(`DROP DATABASE ${dbName}`);
      await admin.end({ timeout: 5 });
    },
  };
}
