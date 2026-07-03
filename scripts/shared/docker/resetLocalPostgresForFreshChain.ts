import { collectCommand } from "../process/collectCommand.ts";
import { dockerContainerExists } from "./dockerContainerExists.ts";
import { dockerContainerVolumeNames } from "./dockerContainerVolumeNames.ts";
import { dockerVolumeExists } from "./dockerVolumeExists.ts";
import {
  POSTGRES_CONTAINER_NAME,
  POSTGRES_VOLUME_NAME,
} from "./dockerComposeEnv.ts";
import { removeDockerContainerAndVolumes } from "./removeDockerContainerAndVolumes.ts";

/**
 * Clears the local Postgres container and its data volumes so the database
 * projection matches a freshly started Hardhat chain instead of retaining
 * market rows from a previous chain. Also removes the canonical
 * `popcharts_postgres_data` volume even when no container mounts it, because
 * Compose would otherwise silently reattach the stale data on the next up.
 */
export async function resetLocalPostgresForFreshChain(options: {
  readonly cwd: string;
  readonly logLabel: string;
}): Promise<void> {
  console.log(
    `[${options.logLabel}] no existing Hardhat RPC; clearing local Postgres so the projection matches the fresh chain`,
  );

  const mountedVolumes = await dockerContainerVolumeNames(
    POSTGRES_CONTAINER_NAME,
    { cwd: options.cwd },
  );

  if (await dockerContainerExists(POSTGRES_CONTAINER_NAME, { cwd: options.cwd })) {
    await removeDockerContainerAndVolumes(POSTGRES_CONTAINER_NAME, options);
  }

  for (const volumeName of new Set([...mountedVolumes, POSTGRES_VOLUME_NAME])) {
    await removeVolumeIfExists(volumeName, options);
  }
}

async function removeVolumeIfExists(
  volumeName: string,
  options: { readonly cwd: string; readonly logLabel: string },
): Promise<void> {
  if (!(await dockerVolumeExists(volumeName, { cwd: options.cwd }))) {
    return;
  }

  console.log(
    `[${options.logLabel}] removing stale Docker volume ${volumeName}`,
  );
  await collectCommand("docker", ["volume", "rm", "-f", volumeName], {
    cwd: options.cwd,
    echoPrefix: "postgres",
    rejectOnFailure: true,
  });
}
