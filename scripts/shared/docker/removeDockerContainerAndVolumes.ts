import { collectCommand } from "../process/collectCommand.ts";
import { dockerContainerVolumeNames } from "./dockerContainerVolumeNames.ts";

/**
 * Force-removes a Docker container together with every volume it mounts, so
 * a stale local Postgres cannot survive under a Compose project name from a
 * different checkout or worktree. Volume names are captured before the
 * container is removed because the mount records disappear with it.
 */
export async function removeDockerContainerAndVolumes(
  name: string,
  options: { readonly cwd: string; readonly logLabel: string },
): Promise<void> {
  const volumeNames = await dockerContainerVolumeNames(name, {
    cwd: options.cwd,
  });

  console.log(`[${options.logLabel}] removing stale Docker container ${name}`);
  await collectCommand("docker", ["rm", "-f", name], {
    cwd: options.cwd,
    echoPrefix: "postgres",
    rejectOnFailure: true,
  });

  for (const volumeName of volumeNames) {
    console.log(
      `[${options.logLabel}] removing stale Docker volume ${volumeName}`,
    );
    await collectCommand("docker", ["volume", "rm", "-f", volumeName], {
      cwd: options.cwd,
      echoPrefix: "postgres",
      rejectOnFailure: true,
    });
  }
}
