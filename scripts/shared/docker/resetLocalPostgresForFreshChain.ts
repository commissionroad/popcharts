import { assertLocalStackDatabaseName } from "../localStack/assertLocalStackDatabaseName.ts";
import { collectCommand } from "../process/collectCommand.ts";
import { POSTGRES_CONTAINER_NAME } from "./dockerComposeEnv.ts";

/**
 * Recreates only one stack's database so its projection matches a fresh local
 * chain without disturbing databases owned by concurrent stacks (ADR 0020).
 * Slot 0 intentionally changes from the legacy container-and-volume removal
 * to the same database-scoped drop used by every other slot.
 */
export async function resetLocalPostgresForFreshChain(options: {
  readonly cwd: string;
  readonly dbName: string;
  readonly logLabel: string;
}): Promise<void> {
  assertLocalStackDatabaseName(options.dbName);

  console.log(
    `[${options.logLabel}] no existing local RPC; recreating database ${options.dbName} for the fresh chain`,
  );

  await runSql(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${options.dbName}' AND pid <> pg_backend_pid()`,
    options,
  );
  await runSql(`DROP DATABASE IF EXISTS "${options.dbName}"`, options);
  await runSql(`CREATE DATABASE "${options.dbName}"`, options);
}

async function runSql(
  sql: string,
  options: { readonly cwd: string; readonly logLabel: string },
): Promise<void> {
  await collectCommand(
    "docker",
    [
      "exec",
      POSTGRES_CONTAINER_NAME,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    {
      cwd: options.cwd,
      echoPrefix: "postgres",
      rejectOnFailure: true,
    },
  );
}
