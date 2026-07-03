import { waitFor } from "../wait/waitFor.ts";
import { collectCommand } from "../process/collectCommand.ts";
import { commandSucceeds } from "../process/commandSucceeds.ts";
import { dockerContainerExists } from "./dockerContainerExists.ts";
import { POSTGRES_CONTAINER_NAME } from "./dockerComposeEnv.ts";

/**
 * Starts the local Postgres container and waits until it accepts
 * connections. Reuses the deterministically named `popcharts-postgres`
 * container when one exists (it may have been created by another worktree);
 * otherwise asks Compose to create it. Postgres is the one long-lived
 * dependency local orchestrators leave running between runs.
 */
export async function ensureLocalPostgres(options: {
  readonly cwd: string;
  readonly logLabel: string;
}): Promise<void> {
  if (await dockerContainerExists(POSTGRES_CONTAINER_NAME)) {
    console.log(
      `[${options.logLabel}] using existing Docker container ${POSTGRES_CONTAINER_NAME}`,
    );
    await collectCommand("docker", ["start", POSTGRES_CONTAINER_NAME], {
      cwd: options.cwd,
      echoPrefix: "postgres",
      rejectOnFailure: true,
    });
    await waitFor(
      "Postgres readiness",
      () =>
        commandSucceeds(
          "docker",
          [
            "exec",
            POSTGRES_CONTAINER_NAME,
            "pg_isready",
            "-U",
            "postgres",
            "-d",
            "popcharts",
          ],
          { cwd: options.cwd },
        ),
      { logLabel: options.logLabel },
    );
    return;
  }

  await collectCommand("docker", ["compose", "up", "-d", "postgres"], {
    cwd: options.cwd,
    echoPrefix: "postgres",
    rejectOnFailure: true,
  });
  await waitFor(
    "Postgres readiness",
    () =>
      commandSucceeds(
        "docker",
        [
          "compose",
          "exec",
          "-T",
          "postgres",
          "pg_isready",
          "-U",
          "postgres",
          "-d",
          "popcharts",
        ],
        { cwd: options.cwd },
      ),
    { logLabel: options.logLabel },
  );
}
