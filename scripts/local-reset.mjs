#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE_PROJECT_NAME = "popcharts";
const POSTGRES_CONTAINER_NAME = "popcharts-postgres";
const POSTGRES_VOLUME_NAME = `${COMPOSE_PROJECT_NAME}_postgres_data`;

main().catch((error) => {
  console.error(`\n[local-reset] ${error.message}`);
  process.exit(1);
});

async function main() {
  console.log("=== Pop Charts local reset ===\n");
  console.log(
    "[local-reset] clearing local Postgres container and Docker volumes",
  );

  const mountedVolumes = await dockerContainerVolumeNames(POSTGRES_CONTAINER_NAME);

  if (await dockerContainerExists(POSTGRES_CONTAINER_NAME)) {
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

async function removeDockerVolume(volumeName) {
  if (!(await dockerVolumeExists(volumeName))) {
    console.log(`[local-reset] Docker volume ${volumeName} is already gone`);
    return;
  }

  await run("docker", ["volume", "rm", "-f", volumeName]);
}

async function dockerContainerExists(name) {
  const result = await collect("docker", ["container", "inspect", name], {
    rejectOnFailure: false,
  });

  return result.code === 0;
}

async function dockerContainerVolumeNames(name) {
  const result = await collect(
    "docker",
    ["container", "inspect", name, "--format", "{{json .Mounts}}"],
    {
      rejectOnFailure: false,
    },
  );

  if (result.code !== 0) {
    return [];
  }

  try {
    const mounts = JSON.parse(result.stdout);

    if (!Array.isArray(mounts)) {
      return [];
    }

    return mounts
      .filter((mount) => mount?.Type === "volume" && mount?.Name)
      .map((mount) => mount.Name);
  } catch {
    return [];
  }
}

async function dockerVolumeExists(name) {
  const result = await collect("docker", ["volume", "inspect", name], {
    rejectOnFailure: false,
  });

  return result.code === 0;
}

function dockerComposeEnv(env = process.env) {
  return {
    ...env,
    COMPOSE_PROJECT_NAME,
  };
}

async function run(command, args, options = {}) {
  console.log(`[local-reset] ${command} ${args.join(" ")}`);
  const result = await collect(command, args, {
    env: options.env,
    rejectOnFailure: options.rejectOnFailure ?? true,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  return result;
}

async function collect(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const code = await new Promise((resolveCode, reject) => {
    child.on("error", reject);
    child.on("exit", (exitCode) => resolveCode(exitCode ?? 0));
  });

  if (options.rejectOnFailure && code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed.\n${stderr || stdout}`);
  }

  return { code, stderr, stdout };
}
