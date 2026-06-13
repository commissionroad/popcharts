import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5433/popcharts";

const requireSsl =
  connectionString.includes("rds.amazonaws.com") ||
  connectionString.includes("sslmode=require") ||
  process.env.DATABASE_SSL === "true";

const client = postgres(connectionString, {
  ssl: requireSsl ? "require" : false,
});

export const db = drizzle(client, { schema });

export function createDb(url: string) {
  const needsSsl =
    url.includes("rds.amazonaws.com") ||
    url.includes("sslmode=require") ||
    process.env.DATABASE_SSL === "true";

  const customClient = postgres(url, {
    ssl: needsSsl ? "require" : false,
  });

  return drizzle(customClient, { schema });
}

export { schema };
export { and, asc, desc, eq, or, sql } from "drizzle-orm";
