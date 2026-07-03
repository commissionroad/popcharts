import { collectCommand } from "../process/collectCommand.ts";

/**
 * Returns the names of volumes mounted by a Docker container, or an empty
 * list when the container does not exist or its mounts cannot be read.
 * Used to clean up a container's data volumes even when they were created
 * under a different Compose project name.
 */
export async function dockerContainerVolumeNames(
  name: string,
  options: { readonly cwd?: string } = {},
): Promise<string[]> {
  const result = await collectCommand(
    "docker",
    ["container", "inspect", name, "--format", "{{json .Mounts}}"],
    { cwd: options.cwd },
  );

  if (result.code !== 0) {
    return [];
  }

  try {
    const mounts: unknown = JSON.parse(result.stdout);

    if (!Array.isArray(mounts)) {
      return [];
    }

    return mounts
      .filter(
        (mount): mount is { Name: string; Type: string } =>
          typeof mount === "object" &&
          mount !== null &&
          (mount as { Type?: unknown }).Type === "volume" &&
          typeof (mount as { Name?: unknown }).Name === "string",
      )
      .map((mount) => mount.Name);
  } catch {
    return [];
  }
}
