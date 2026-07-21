import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  getDatabaseConnectionString,
  requiresDatabaseSsl,
} from "src/config/database";
import * as schema from "./schema";

type Db = ReturnType<typeof createDb>;

let activeClient: ReturnType<typeof postgres> | null = null;
let activeDb: Db | null = null;

function ambientDb(): Db {
  if (!activeDb) {
    const connectionString = getDatabaseConnectionString();
    activeClient = postgres(connectionString, {
      ssl: requiresDatabaseSsl(connectionString) ? "require" : false,
    });
    activeDb = drizzle(activeClient, { schema });
  }
  return activeDb;
}

/**
 * The process-wide Drizzle database handle, resolved lazily from environment
 * config on first use (ADR 0017 Track B: lazy so tests can inject a
 * substitute before any connection exists). Import this everywhere instead
 * of opening new connections.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const target = ambientDb();
    const value = Reflect.get(target as object, prop, target);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(target)
      : value;
  },
  has(_target, prop) {
    return Reflect.has(ambientDb() as object, prop);
  },
});

/**
 * Replaces the handle behind `db` — test-support only. Pass null to restore
 * the ambient environment-configured database on next use.
 */
export function setDbForTesting(override: Db | null) {
  activeDb = override;
}

/**
 * Closes the shared connection pool (5s drain timeout) so scripts and tests
 * using `db` can exit instead of hanging on open sockets.
 */
export async function closeDb() {
  if (activeClient) {
    await activeClient.end({ timeout: 5 });
    activeClient = null;
    activeDb = null;
  }
}

/**
 * Opens an independent Drizzle handle for an explicit connection string —
 * for migrations and scripts that target a database other than the ambient
 * one. The caller owns the connection's lifecycle; closeDb does not touch it.
 */
export function createDb(url: string) {
  const needsSsl = requiresDatabaseSsl(url);

  const customClient = postgres(url, {
    ssl: needsSsl ? "require" : false,
  });

  return drizzle(customClient, { schema });
}

export { schema };
export {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
