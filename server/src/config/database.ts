const DEFAULT_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5433/popcharts";

type DatabaseEnv = Record<string, string | undefined>;

/**
 * Resolves the Postgres connection string with a strict precedence:
 * DATABASE_URL verbatim, then a URL assembled from DATABASE_HOST/PORT/NAME/
 * USER/PASSWORD (password required, sslmode appended when SSL applies), then
 * the local docker-compose default on port 5433.
 */
export function getDatabaseConnectionString(env: DatabaseEnv = process.env) {
  if (env.DATABASE_URL) {
    return env.DATABASE_URL;
  }

  if (!env.DATABASE_HOST) {
    return DEFAULT_DATABASE_URL;
  }

  if (!env.DATABASE_PASSWORD) {
    throw new Error(
      "DATABASE_PASSWORD is required when DATABASE_HOST is configured.",
    );
  }

  const host = env.DATABASE_HOST;
  const port = env.DATABASE_PORT ?? "5432";
  const databaseName = env.DATABASE_NAME ?? "popcharts";
  const username = env.DATABASE_USER ?? "postgres";
  const url = new URL(`postgresql://${host}:${port}/${databaseName}`);

  url.username = username;
  url.password = env.DATABASE_PASSWORD;

  if (requiresDatabaseSsl(url.toString(), env)) {
    url.searchParams.set("sslmode", "require");
  }

  return url.toString();
}

/**
 * Whether connections must use SSL: forced by DATABASE_SSL=true, and inferred
 * for RDS hosts and URLs already carrying sslmode=require, so managed
 * databases are never dialed in plaintext by default.
 */
export function requiresDatabaseSsl(
  connectionString: string,
  env: DatabaseEnv = process.env,
) {
  return (
    env.DATABASE_SSL === "true" ||
    connectionString.includes("rds.amazonaws.com") ||
    connectionString.includes("sslmode=require")
  );
}
