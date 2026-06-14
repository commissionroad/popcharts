const DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@localhost:5433/popcharts";

type DatabaseEnv = Record<string, string | undefined>;

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
