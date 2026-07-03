import { waitFor } from "../wait/waitFor.ts";
import { collectCommand } from "../process/collectCommand.ts";
import { commandSucceeds } from "../process/commandSucceeds.ts";
import { dockerContainerExists } from "./dockerContainerExists.ts";
import { dockerContainerVolumeNames } from "./dockerContainerVolumeNames.ts";
import {
  POSTGRES_CONTAINER_NAME,
  dockerComposeEnv,
} from "./dockerComposeEnv.ts";
import { removeDockerContainerAndVolumes } from "./removeDockerContainerAndVolumes.ts";

/**
 * Starts the local Postgres container and waits until it accepts
 * connections. Reuses the deterministically named `popcharts-postgres`
 * container when one exists (it may have been created by another worktree);
 * otherwise asks Compose to create it under the shared project name.
 * When `expectedVolumeName` is set, a container that does not mount that
 * volume is treated as stale and recreated together with its volumes, so a
 * later reset actually clears the data the container was using. Postgres is
 * the one long-lived dependency local orchestrators leave running between
 * runs.
 */
export async function ensureLocalPostgres(options: {
  readonly cwd: string;
  readonly expectedVolumeName?: string;
  readonly logLabel: string;
}): Promise<void> {
  if (await dockerContainerExists(POSTGRES_CONTAINER_NAME)) {
    const staleVolumes =
      options.expectedVolumeName === undefined
        ? null
        : await findUnexpectedVolumes(options.expectedVolumeName, options.cwd);

    if (staleVolumes === null) {
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

    console.log(
      `[${options.logLabel}] existing ${POSTGRES_CONTAINER_NAME} uses ${formatVolumeNames(
        staleVolumes,
      )}; expected ${options.expectedVolumeName}`,
    );
    await removeDockerContainerAndVolumes(POSTGRES_CONTAINER_NAME, {
      cwd: options.cwd,
      logLabel: options.logLabel,
    });
  }

  await collectCommand("docker", ["compose", "up", "-d", "postgres"], {
    cwd: options.cwd,
    echoPrefix: "postgres",
    env: dockerComposeEnv(),
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
        { cwd: options.cwd, env: dockerComposeEnv() },
      ),
    { logLabel: options.logLabel },
  );
}

// Returns the container's mounted volume names when the expected volume is
// missing, or null when the container is safe to reuse.
async function findUnexpectedVolumes(
  expectedVolumeName: string,
  cwd: string,
): Promise<string[] | null> {
  const volumeNames = await dockerContainerVolumeNames(
    POSTGRES_CONTAINER_NAME,
    { cwd },
  );

  return volumeNames.includes(expectedVolumeName) ? null : volumeNames;
}

function formatVolumeNames(volumeNames: readonly string[]): string {
  return volumeNames.length > 0 ? volumeNames.join(", ") : "no Docker volume";
}
