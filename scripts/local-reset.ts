#!/usr/bin/env -S node --experimental-strip-types

import {
  COMPOSE_PROJECT_NAME,
  POSTGRES_CONTAINER_NAME,
  dockerComposeEnv,
} from "./shared/docker/dockerComposeEnv.ts";
import { dockerContainerExists } from "./shared/docker/dockerContainerExists.ts";
import { dockerContainerVolumeNames } from "./shared/docker/dockerContainerVolumeNames.ts";
import { dockerVolumeExists } from "./shared/docker/dockerVolumeExists.ts";
import { collectCommand } from "./shared/process/collectCommand.ts";
import { repoRoot } from "./shared/paths.ts";

/**
 * Resets local Pop Charts infrastructure: removes the Postgres container,
 * tears down the Compose project, and deletes its data volumes so the next
 * `local:dev` or `local:smoke` run starts from a clean database.
 */

const POSTGRES_VOLUME_NAME = `${COMPOSE_PROJECT_NAME}_postgres_data`;

main().catch((error: unknown) => {
  console.error(
    `\n[local-reset] ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
});

async function main(): Promise<void> {
  console.log("=== Pop Charts local reset ===\n");
  console.log(
    "[local-reset] clearing local Postgres container and Docker volumes",
  );

  const mountedVolumes = await dockerContainerVolumeNames(
    POSTGRES_CONTAINER_NAME,
    { cwd: repoRoot },
  );

  if (await dockerContainerExists(POSTGRES_CONTAINER_NAME, { cwd: repoRoot })) {
    await run("docker", ["rm", "-f", POSTGRES_CONTAINER_NAME]);
  } else {
    console.log(
      `[local-reset] Docker container ${POSTGRES_CONTAINER_NAME} is already gone`,
    );
  }

  await run("docker", ["compose", "down", "-v", "--remove-orphans"], {
    env: dockerComposeEnv(),
    rejectOnFailure: false,
  });

  for (const volumeName of new Set([...mountedVolumes, POSTGRES_VOLUME_NAME])) {
    await removeDockerVolume(volumeName);
  }

  console.log("\n[local-reset] done");
}

async function removeDockerVolume(volumeName: string): Promise<void> {
  if (!(await dockerVolumeExists(volumeName, { cwd: repoRoot }))) {
    console.log(`[local-reset] Docker volume ${volumeName} is already gone`);
    return;
  }

  await run("docker", ["volume", "rm", "-f", volumeName]);
}

async function run(
  command: string,
  args: readonly string[],
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly rejectOnFailure?: boolean;
  } = {},
): Promise<void> {
  console.log(`[local-reset] ${command} ${args.join(" ")}`);
  const result = await collectCommand(command, args, {
    cwd: repoRoot,
    env: options.env,
    rejectOnFailure: options.rejectOnFailure ?? true,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
}
