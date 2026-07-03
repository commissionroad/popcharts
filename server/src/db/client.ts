import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  getDatabaseConnectionString,
  requiresDatabaseSsl,
} from "src/config/database";
import * as schema from "./schema";

const connectionString = getDatabaseConnectionString();
const requireSsl = requiresDatabaseSsl(connectionString);

const client = postgres(connectionString, {
  ssl: requireSsl ? "require" : false,
});

/**
 * The process-wide Drizzle database handle, connected from environment config
 * at module load with SSL enforced automatically for managed hosts. Import
 * this everywhere instead of opening new connections.
 */
export const db = drizzle(client, { schema });

/**
 * Closes the shared connection pool (5s drain timeout) so scripts and tests
 * using `db` can exit instead of hanging on open sockets.
 */
export async function closeDb() {
  await client.end({ timeout: 5 });
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
  lte,
  or,
  sql,
} from "drizzle-orm";
