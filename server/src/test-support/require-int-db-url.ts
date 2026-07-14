// Guard for `bun run test:integration`: without POPCHARTS_INT_DB_URL every
// *.int.test.ts self-skips and the command would exit green having tested
// nothing. The plain unit run (`bun test`) is the one allowed to skip.
if (!process.env.POPCHARTS_INT_DB_URL) {
  console.error(
    "POPCHARTS_INT_DB_URL is required for test:integration (e.g. postgresql://postgres:postgres@localhost:5433/postgres for the docker-compose Postgres).",
  );
  process.exit(1);
}
