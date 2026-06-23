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

export const db = drizzle(client, { schema });

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
