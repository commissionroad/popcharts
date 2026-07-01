#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = resolve(repoRoot, "app");
const protocolDir = resolve(repoRoot, "protocol");
const serverDir = resolve(repoRoot, "server");

const DEFAULT_HARDHAT_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const APP_ENV_START = "# BEGIN POPCHARTS LOCAL DEV";
const APP_ENV_END = "# END POPCHARTS LOCAL DEV";
const COMPOSE_PROJECT_NAME = "popcharts";
const POSTGRES_CONTAINER_NAME = "popcharts-postgres";
const POSTGRES_VOLUME_NAME = `${COMPOSE_PROJECT_NAME}_postgres_data`;

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const helpRequested = args.includes("--help") || args.includes("-h");
const aiReviewOnly = args.includes("--ai-review-only");
const noAiReview = args.includes("--no-ai-review");
const aiReviewEnabled = aiReviewOnly || !noAiReview;
const keepDb = args.includes("--keep-db");

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5433/popcharts";
const rpcHost = "127.0.0.1";
const rpcPort = "8545";
const rpcHttpUrl = `http://${rpcHost}:${rpcPort}`;
const rpcWssUrl = `ws://${rpcHost}:${rpcPort}`;
const apiPort = process.env.LOCAL_API_PORT ?? "3001";
const appPort = process.env.LOCAL_APP_PORT ?? "3000";
const aiReviewPort = process.env.LOCAL_AI_REVIEW_PORT ?? "3002";
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const appBaseUrl = `http://127.0.0.1:${appPort}`;
const aiReviewBaseUrl = `http://127.0.0.1:${aiReviewPort}`;

const serverEnvFile = resolve(serverDir, ".env.local-chain");
const appEnvFile = resolve(appDir, ".env.development.local");
const healthFile = resolve(serverDir, ".env.local-dev.indexer-health");
const children = new Set();
let shuttingDown = false;

if (helpRequested) {
  printUsage();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown(130);
});
process.on("SIGTERM", () => {
  void shutdown(143);
});

main().catch(async (error) => {
  console.error(`\n[local-dev] ${error.message}`);
  await shutdown(1);
});

async function main() {
  console.log(
    aiReviewOnly
      ? "=== Pop Charts local AI review stack ===\n"
      : "=== Pop Charts local dev stack ===\n",
  );
  rejectUnknownArgs();
  rejectConflictingArgs();
  ensureDependenciesInstalled();

  rmSync(healthFile, { force: true });

  const reuseExistingHardhatRpc = !aiReviewOnly && (await rpcReady());
  if (!aiReviewOnly && !reuseExistingHardhatRpc && !keepDb) {
    await resetLocalPostgresForFreshChain();
  } else if (!aiReviewOnly && !reuseExistingHardhatRpc && keepDb) {
    console.warn(
      "[local-dev] --keep-db was passed while starting a fresh Hardhat chain. " +
        "Old local market rows may not match the new chain.",
    );
  }

  await ensurePostgres();

  const initialServerEnv = buildServerEnv();
  await run(
    "db constraints",
    "bun",
    ["run", "--cwd", "server", "db:ensure-local-constraints"],
    {
      cwd: repoRoot,
      env: initialServerEnv,
    },
  );
  await run("db", "bun", ["run", "--cwd", "server", "db:push"], {
    cwd: repoRoot,
    env: initialServerEnv,
  });

  if (aiReviewOnly) {
    const aiReviewProcesses = await startAiReviewStack({
      serverEnv: initialServerEnv,
    });

    console.log("\nLocal AI review stack is ready:");
    console.log(`- AI Review service: ${aiReviewBaseUrl}`);
    console.log(`- AI Review readiness: ${aiReviewBaseUrl}/ready`);
    console.log(`- Runner: polling Postgres every ${localAiReviewRunnerPollMs()}ms`);
    console.log(`- Database: ${databaseUrl}`);
    console.log("\nPress Ctrl-C to stop the AI review service and runner.");

    await waitForever(aiReviewProcesses);
    return;
  }

  let hardhatNode = null;
  if (reuseExistingHardhatRpc) {
    console.log(`[local-dev] using existing Hardhat RPC at ${rpcHttpUrl}`);
  } else {
    hardhatNode = start("hardhat", "pnpm", [
      "--dir",
      "protocol",
      "exec",
      "hardhat",
      "node",
      "--hostname",
      rpcHost,
      "--port",
      rpcPort,
    ]);
  }

  await waitFor("Hardhat RPC", () => rpcReady(), {
    processes: hardhatNode ? [hardhatNode] : [],
    timeoutMs: 45_000,
  });

  const deployOutput = await run(
    "deploy",
    "pnpm",
    ["--dir", "protocol", "run", "local:deploy-pregrad"],
    {
      cwd: repoRoot,
    },
  );
  const deploy = parseLabeledJson(
    deployOutput.stdout,
    "LOCAL_CHAIN_SMOKE_DEPLOY",
  );
  const serverEnv = buildServerEnv({
    collateralAddress: deploy.collateralAddress,
    deployBlock: deploy.deployBlock,
    pregradManagerAddress: deploy.pregradManagerAddress,
  });
  const appEnv = buildAppEnv(deploy);
  writeServerEnv(serverEnv, deploy);
  writeAppEnv(appEnv);

  const aiReviewProcesses = aiReviewEnabled
    ? await startAiReviewStack({ serverEnv })
    : [];

  const api = start("api", "bun", ["run", "--cwd", "server", "start:api"], {
    env: serverEnv,
  });
  await waitFor("API health", () => urlOk(`${apiBaseUrl}/health`), {
    processes: [api],
    timeoutMs: 30_000,
  });

  const indexer = start(
    "indexer",
    "bun",
    ["run", "--cwd", "server", "start:indexer"],
    {
      env: serverEnv,
    },
  );
  await waitFor("Indexer health marker", () => existsSync(healthFile), {
    processes: [api, indexer],
    timeoutMs: 45_000,
  });

  const app = start(
    "app",
    "pnpm",
    [
      "--dir",
      "app",
      "exec",
      "next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      appPort,
    ],
    {
      env: appEnv,
    },
  );
  await waitFor("Next.js app", () => urlOk(`${appBaseUrl}/create`), {
    processes: [
      api,
      indexer,
      app,
      ...aiReviewProcesses,
      ...(hardhatNode ? [hardhatNode] : []),
    ],
    timeoutMs: 120_000,
  });

  console.log("\nLocal dev stack is ready:");
  console.log(`- App: ${appBaseUrl}`);
  console.log(`- Create market: ${appBaseUrl}/create`);
  console.log(`- Markets list: ${appBaseUrl}/`);
  console.log(`- API: ${apiBaseUrl}/markets?chainId=${deploy.chainId}`);
  if (aiReviewEnabled) {
    console.log(`- AI Review service: ${aiReviewBaseUrl}`);
    console.log(`- AI Review runner: enabled`);
  } else {
    console.log(`- AI Review runner: disabled`);
  }
  console.log(`- Hardhat RPC: ${rpcHttpUrl}`);
  console.log(`- PregradManager: ${deploy.pregradManagerAddress}`);
  console.log(`- Collateral: ${deploy.collateralAddress}`);
  console.log(`- App env: ${appEnvFile}`);
  console.log(`- Server env: ${serverEnvFile}`);
  console.log(
    "\nPress Ctrl-C to stop API, indexer, app, AI review, and local chain.",
  );

  await waitForever([
    api,
    indexer,
    app,
    ...aiReviewProcesses,
    ...(hardhatNode ? [hardhatNode] : []),
  ]);
}

function printUsage() {
  console.log(`Usage: pnpm run local:dev
       pnpm run local:dev -- --no-ai-review
       pnpm run local:dev -- --keep-db
       pnpm run local:ai-review

Start the full local Pop Charts stack:
  - docker-compose Postgres
  - Hardhat local chain
  - local PregradManager and MockCollateral deployment
  - Bun API server
  - Bun indexer
  - local AI Review service and runner in heuristic mode
  - Next.js app configured for devchain market creation

Environment overrides:
  LOCAL_APP_PORT=3000
  LOCAL_API_PORT=3001
  LOCAL_AI_REVIEW_PORT=3002
  LOCAL_AI_REVIEW_PROVIDER=heuristic
  LOCAL_AI_REVIEW_INTERNET_ACCESS=off
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/popcharts`);
}

function rejectUnknownArgs() {
  const knownArgs = new Set([
    "--ai-review-only",
    "--help",
    "--keep-db",
    "--no-ai-review",
    "-h",
  ]);
  const unknownArgs = args.filter((arg) => !knownArgs.has(arg));

  if (unknownArgs.length > 0) {
    throw new Error(
      `Unknown option(s): ${unknownArgs.join(", ")}. Use --help.`,
    );
  }
}

function rejectConflictingArgs() {
  if (aiReviewOnly && noAiReview) {
    throw new Error("--ai-review-only cannot be combined with --no-ai-review.");
  }
}

async function resetLocalPostgresForFreshChain() {
  console.log(
    "[local-dev] no existing Hardhat RPC; clearing local Postgres so the projection matches the fresh chain",
  );

  const mountedVolumes = await dockerContainerVolumeNames(
    POSTGRES_CONTAINER_NAME,
  );

  if (await dockerContainerExists(POSTGRES_CONTAINER_NAME)) {
    await removeDockerContainerAndVolumes(POSTGRES_CONTAINER_NAME);
  }

  for (const volumeName of new Set([...mountedVolumes, POSTGRES_VOLUME_NAME])) {
    await removeDockerVolumeIfExists(volumeName);
  }
}

function ensureDependenciesInstalled() {
  const missing = [];

  if (!existsSync(resolve(appDir, "node_modules"))) {
    missing.push("app/node_modules");
  }

  if (!existsSync(resolve(protocolDir, "node_modules"))) {
    missing.push("protocol/node_modules");
  }

  if (!existsSync(resolve(serverDir, "node_modules"))) {
    missing.push("server/node_modules");
  }

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    `Missing ${missing.join(", ")}. Run 'just setup' before 'just local-dev'.`,
  );
}

async function ensurePostgres() {
  if (await dockerContainerExists(POSTGRES_CONTAINER_NAME)) {
    const volumeNames = await dockerContainerVolumeNames(
      POSTGRES_CONTAINER_NAME,
    );

    if (!volumeNames.includes(POSTGRES_VOLUME_NAME)) {
      console.log(
        `[local-dev] existing ${POSTGRES_CONTAINER_NAME} uses ${formatVolumeNames(
          volumeNames,
        )}; expected ${POSTGRES_VOLUME_NAME}`,
      );
      await removeDockerContainerAndVolumes(POSTGRES_CONTAINER_NAME);
    } else {
      console.log(
        `[local-dev] using existing Docker container ${POSTGRES_CONTAINER_NAME}`,
      );
      await run("postgres", "docker", ["start", POSTGRES_CONTAINER_NAME], {
        cwd: repoRoot,
      });
      await waitFor("Postgres readiness", () => postgresReady());
      return;
    }
  }

  await run("postgres", "docker", ["compose", "up", "-d", "postgres"], {
    cwd: repoRoot,
    env: dockerComposeEnv(),
  });
  await waitFor("Postgres readiness", () =>
    postgresReady(),
  );
}

async function postgresReady() {
  return commandSucceeds("docker", [
    "exec",
    POSTGRES_CONTAINER_NAME,
    "psql",
    "-U",
    "postgres",
    "-d",
    "popcharts",
    "-c",
    "select 1",
  ]);
}

async function removeDockerVolumeIfExists(volumeName) {
  if (!(await dockerVolumeExists(volumeName))) {
    return;
  }

  console.log(`[local-dev] removing stale Docker volume ${volumeName}`);
  await run("postgres", "docker", ["volume", "rm", "-f", volumeName], {
    cwd: repoRoot,
  });
}

async function removeDockerContainerAndVolumes(name) {
  const volumeNames = await dockerContainerVolumeNames(name);

  console.log(`[local-dev] removing stale Docker container ${name}`);
  await run("postgres", "docker", ["rm", "-f", name], {
    cwd: repoRoot,
  });

  for (const volumeName of volumeNames) {
    console.log(`[local-dev] removing stale Docker volume ${volumeName}`);
    await run("postgres", "docker", ["volume", "rm", "-f", volumeName], {
      cwd: repoRoot,
    });
  }
}

async function dockerContainerVolumeNames(name) {
  const result = await collect(
    "docker",
    ["container", "inspect", name, "--format", "{{json .Mounts}}"],
    {
      cwd: repoRoot,
      env: process.env,
      print: false,
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

function formatVolumeNames(volumeNames) {
  return volumeNames.length > 0 ? volumeNames.join(", ") : "no Docker volume";
}

function dockerComposeEnv(env = process.env) {
  return {
    ...env,
    COMPOSE_PROJECT_NAME,
  };
}

async function dockerContainerExists(name) {
  const result = await collect("docker", ["container", "inspect", name], {
    cwd: repoRoot,
    env: process.env,
    print: false,
    rejectOnFailure: false,
  });

  return result.code === 0;
}

async function dockerVolumeExists(name) {
  const result = await collect("docker", ["volume", "inspect", name], {
    cwd: repoRoot,
    env: process.env,
    print: false,
    rejectOnFailure: false,
  });

  return result.code === 0;
}

function buildServerEnv(overrides = {}) {
  return {
    AI_REVIEW_SERVICE_URL: aiReviewBaseUrl,
    AI_REVIEW_RUNNER_POLL_MS: localAiReviewRunnerPollMs(),
    DATABASE_URL: databaseUrl,
    HEALTH_CHECK_FILE: healthFile,
    LOCAL_COLLATERAL_ADDRESS: overrides.collateralAddress ?? "",
    LOCAL_PREGRAD_MANAGER_ADDRESS: overrides.pregradManagerAddress ?? "",
    LOCAL_PREGRAD_MANAGER_DEPLOY_BLOCK: overrides.deployBlock ?? "0",
    NETWORK: "local",
    PORT: apiPort,
    POPCHARTS_ADMIN_REVIEW_ENABLED: "true",
    POPCHARTS_DEVCHAIN_PRIVATE_KEY:
      process.env.POPCHARTS_DEVCHAIN_PRIVATE_KEY ?? DEFAULT_HARDHAT_PRIVATE_KEY,
    POPCHARTS_DEV_TOOLS_ENABLED: "true",
    PREGRAD_MANAGER_ADDRESS: overrides.pregradManagerAddress ?? "",
    PREGRAD_MANAGER_DEPLOY_BLOCK: overrides.deployBlock ?? "0",
    RPC_HTTP_URL: rpcHttpUrl,
    RPC_WSS_URL: rpcWssUrl,
  };
}

async function startAiReviewStack({ serverEnv }) {
  const aiReviewEnv = buildAiReviewEnv(serverEnv);
  const aiReview = start(
    "ai-review",
    "bun",
    ["run", "--cwd", "server", "start:ai-review"],
    {
      env: aiReviewEnv,
    },
  );

  await waitFor(
    "AI Review service readiness",
    () => urlOk(`${aiReviewBaseUrl}/ready`),
    {
      processes: [aiReview],
      timeoutMs: 30_000,
    },
  );

  const runner = start(
    "ai-review-runner",
    "bun",
    ["run", "--cwd", "server", "start:ai-review-runner"],
    {
      env: buildAiReviewRunnerEnv(serverEnv),
    },
  );

  return [aiReview, runner];
}

function buildAiReviewEnv(serverEnv) {
  return {
    ...serverEnv,
    AI_REVIEW_FETCH_SEARCH_RESULTS:
      process.env.LOCAL_AI_REVIEW_FETCH_SEARCH_RESULTS ?? "false",
    AI_REVIEW_INTERNET_ACCESS: localAiReviewInternetAccess(),
    AI_REVIEW_PORT: aiReviewPort,
    AI_REVIEW_PROVIDER: localAiReviewProvider(),
  };
}

function buildAiReviewRunnerEnv(serverEnv) {
  return {
    ...serverEnv,
    AI_REVIEW_RUNNER_ID:
      process.env.LOCAL_AI_REVIEW_RUNNER_ID ?? "local-ai-review-runner",
    AI_REVIEW_RUNNER_POLL_MS: localAiReviewRunnerPollMs(),
    AI_REVIEW_SERVICE_URL: aiReviewBaseUrl,
  };
}

function localAiReviewProvider() {
  return process.env.LOCAL_AI_REVIEW_PROVIDER ?? "heuristic";
}

function localAiReviewInternetAccess() {
  return process.env.LOCAL_AI_REVIEW_INTERNET_ACCESS ?? "off";
}

function localAiReviewRunnerPollMs() {
  return process.env.LOCAL_AI_REVIEW_RUNNER_POLL_MS ?? "1000";
}

function buildAppEnv(deploy) {
  return {
    NEXT_PUBLIC_POPCHARTS_CHAIN_ENV: "local",
    NEXT_PUBLIC_POPCHARTS_MARKET_CREATION_MODE: "devchain",
    NEXT_PUBLIC_POPCHARTS_MARKET_CREATION_SIGNER: "wallet",
    NEXT_PUBLIC_POPCHARTS_CHAIN_ID: String(deploy.chainId),
    NEXT_PUBLIC_POPCHARTS_RPC_URL: rpcHttpUrl,
    NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS: deploy.pregradManagerAddress,
    NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS: deploy.collateralAddress,
    NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN: "true",
    NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_WALLET: "true",
    NEXT_PUBLIC_POPCHARTS_DEV_TOOLS_ENABLED: "true",
    POPCHARTS_DEVCHAIN_ENABLED: "true",
    POPCHARTS_DEVCHAIN_PRIVATE_KEY:
      process.env.POPCHARTS_DEVCHAIN_PRIVATE_KEY ?? DEFAULT_HARDHAT_PRIVATE_KEY,
    POPCHARTS_INDEXER_API_URL: apiBaseUrl,
    POPCHARTS_MARKET_DATA_SOURCE: "api",
    POPCHARTS_MARKETS_CHAIN_ID: String(deploy.chainId),
  };
}

function writeServerEnv(env, deploy) {
  const lines = [
    "# Generated by scripts/local-dev.mjs.",
    "# Safe to delete; ignored by git.",
    `DATABASE_URL=${env.DATABASE_URL}`,
    `PORT=${env.PORT}`,
    "NETWORK=local",
    `POPCHARTS_ADMIN_REVIEW_ENABLED=${env.POPCHARTS_ADMIN_REVIEW_ENABLED}`,
    `POPCHARTS_DEV_TOOLS_ENABLED=${env.POPCHARTS_DEV_TOOLS_ENABLED}`,
    `AI_REVIEW_SERVICE_URL=${env.AI_REVIEW_SERVICE_URL}`,
    `AI_REVIEW_RUNNER_POLL_MS=${env.AI_REVIEW_RUNNER_POLL_MS}`,
    `RPC_HTTP_URL=${env.RPC_HTTP_URL}`,
    `RPC_WSS_URL=${env.RPC_WSS_URL}`,
    `PREGRAD_MANAGER_ADDRESS=${deploy.pregradManagerAddress}`,
    `PREGRAD_MANAGER_DEPLOY_BLOCK=${deploy.deployBlock}`,
    `LOCAL_PREGRAD_MANAGER_ADDRESS=${deploy.pregradManagerAddress}`,
    `LOCAL_PREGRAD_MANAGER_DEPLOY_BLOCK=${deploy.deployBlock}`,
    `LOCAL_COLLATERAL_ADDRESS=${deploy.collateralAddress}`,
    `HEALTH_CHECK_FILE=${env.HEALTH_CHECK_FILE}`,
    "",
  ];

  writeFileSync(serverEnvFile, lines.join("\n"));
}

function writeAppEnv(env) {
  const existing = readOptional(appEnvFile);
  const block = [
    APP_ENV_START,
    ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
    APP_ENV_END,
    "",
  ].join("\n");
  const pattern = new RegExp(
    `${escapeRegExp(APP_ENV_START)}[\\s\\S]*?${escapeRegExp(APP_ENV_END)}\\n?`,
    "m",
  );
  const next = pattern.test(existing)
    ? existing.replace(pattern, block)
    : `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${block}`;

  writeFileSync(appEnvFile, next);
}

function readOptional(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

function start(name, command, args, options = {}) {
  console.log(`\n[local-dev] starting ${name}: ${command} ${args.join(" ")}`);
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const processInfo = { child, code: null, name };

  children.add(processInfo);
  pipeWithPrefix(name, child.stdout);
  pipeWithPrefix(name, child.stderr);
  child.on("exit", (code) => {
    processInfo.code = code;
    children.delete(processInfo);
  });

  return processInfo;
}

async function run(name, command, args, options = {}) {
  console.log(`\n[local-dev] ${name}: ${command} ${args.join(" ")}`);

  return await collect(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    name,
    print: true,
    rejectOnFailure: true,
  });
}

async function commandSucceeds(command, args, env = process.env) {
  const result = await collect(command, args, {
    cwd: repoRoot,
    env,
    print: false,
    rejectOnFailure: false,
  });

  return result.code === 0;
}

async function waitForever(processes) {
  while (true) {
    assertProcessesRunning(processes);
    await sleep(1_000);
  }
}

async function collect(command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
    if (options.print) {
      writePrefixed(options.name, text);
    }
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    if (options.print) {
      writePrefixed(options.name, text);
    }
  });

  const code = await new Promise((resolveCode, reject) => {
    child.on("error", reject);
    child.on("exit", (exitCode) => resolveCode(exitCode ?? 0));
  });

  if (options.rejectOnFailure && code !== 0) {
    throw new Error(
      `${options.name} failed with exit code ${code}.\n${stderr || stdout}`,
    );
  }

  return { code, stderr, stdout };
}

async function waitFor(label, predicate, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    assertProcessesRunning(options.processes ?? []);

    try {
      const value = await predicate();

      if (value) {
        console.log(`[local-dev] ${label} ready`);
        return value;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  const suffix = lastError ? ` Last error: ${lastError.message}` : "";
  throw new Error(
    `${label} did not become ready within ${timeoutMs}ms.${suffix}`,
  );
}

function assertProcessesRunning(processes) {
  if (shuttingDown) {
    return;
  }

  for (const processInfo of processes) {
    if (processInfo.code !== null) {
      throw new Error(
        `${processInfo.name} exited before local dev was ready (code ${processInfo.code}).`,
      );
    }
  }
}

async function rpcReady() {
  try {
    const response = await fetch(rpcHttpUrl, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "eth_chainId",
        params: [],
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    return response.ok;
  } catch {
    return false;
  }
}

async function urlOk(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

function parseLabeledJson(stdout, label) {
  const prefix = `${label}=`;
  const line = stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(prefix));

  if (!line) {
    throw new Error(`Could not find ${label} in command output.`);
  }

  return JSON.parse(line.slice(prefix.length));
}

function pipeWithPrefix(name, stream) {
  stream.on("data", (chunk) => {
    writePrefixed(name, chunk.toString());
  });
}

function writePrefixed(name, text) {
  for (const line of text.split(/\r?\n/)) {
    if (line.length > 0) {
      console.log(`[${name}] ${line}`);
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

async function shutdown(code) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const processInfo of [...children].reverse()) {
    await stop(processInfo);
  }

  process.exit(code);
}

async function stop(processInfo) {
  if (processInfo.code !== null) {
    return;
  }

  processInfo.child.kill("SIGTERM");

  await Promise.race([
    new Promise((resolveStop) => {
      processInfo.child.once("exit", resolveStop);
    }),
    sleep(3_000).then(() => {
      if (processInfo.code === null) {
        processInfo.child.kill("SIGKILL");
      }
    }),
  ]);
}
