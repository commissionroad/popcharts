import { collectCommand } from "../process/collectCommand.ts";

/** True when a Docker volume with the given name exists. */
export async function dockerVolumeExists(
  name: string,
  options: { readonly cwd?: string } = {},
): Promise<boolean> {
  const result = await collectCommand("docker", ["volume", "inspect", name], {
    cwd: options.cwd,
  });

  return result.code === 0;
}
