import { collectCommand } from "../process/collectCommand.ts";

/** True when a Docker container with the given name exists (in any state). */
export async function dockerContainerExists(
  name: string,
  options: { readonly cwd?: string } = {},
): Promise<boolean> {
  const result = await collectCommand(
    "docker",
    ["container", "inspect", name],
    { cwd: options.cwd },
  );

  return result.code === 0;
}
