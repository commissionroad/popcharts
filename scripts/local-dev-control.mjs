#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

const CONTROL_FILE = resolve(repoRoot, "local-dev.control-plane.yaml");
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
const logsDir = resolve(repoRoot, ".local-dev", "logs");

const internalCommands = new Set([
  "api",
  "api-ready",
  "app",
  "app-ready",
  "chain",
  "database-log",
  "deploy-contracts",
  "indexer",
  "indexer-ready",
  "postgres-ready",
  "prepare-database",
  "review-ready",
  "review-runner",
  "review-service",
  "rpc-ready",
]);

const [command, ...args] = process.argv.slice(2).filter((arg) => arg !== "--");

if (command === "--help" || command === "-h") {
  printUsage();
  process.exit(0);
}

if (internalCommands.has(command)) {
  runInternal(command).catch((error) => {
    console.error(`[local-dev-control] ${error.message}`);
    process.exit(1);
  });
} else {
  startControlPlane([command, ...args].filter(Boolean)).catch((error) => {
    console.error(`[local-dev-control] ${error.message}`);
    process.exit(1);
  });
}

async function startControlPlane(rawArgs) {
  const passthrough = [];
  const env = { ...process.env };
  let noAiReview = false;
  let aiReviewOnly = false;

  for (const arg of rawArgs) {
    if (arg === "--keep-db") {
      env.POPCHARTS_LOCAL_DEV_KEEP_DB = "true";
    } else if (arg === "--no-ai-review") {
      noAiReview = true;
    } else if (arg === "--ai-review-only") {
      aiReviewOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      return;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option ${arg}. Use --help.`);
    } else {
      passthrough.push(arg);
    }
  }

  if (noAiReview && aiReviewOnly) {
    throw new Error("--no-ai-review cannot be combined with --ai-review-only.");
  }

  await ensureToolInstalled();
  mkdirSync(logsDir, { recursive: true });

  const selectedProcesses =
    passthrough.length > 0
      ? passthrough
      : aiReviewOnly
        ? ["database-log", "review-service", "review-runner"]
        : noAiReview
          ? ["database-log", "app"]
          : [];

  const processArgs = ["-f", CONTROL_FILE, "up", ...selectedProcesses];

  console.log("=== Pop Charts local dev control plane ===\n");
  console.log(
    selectedProcesses.length > 0
      ? `[local-dev-control] starting ${selectedProcesses.join(", ")}`
      : "[local-dev-control] starting full stack",
  );
  console.log("[local-dev-control] press ? in the TUI for keyboard help\n");

  await inherit("process-compose", processArgs, { env });
}

async function runInternal(name) {
  if (name === "prepare-database") {
    await prepareDatabase();
  } else if (name === "database-log") {
    await databaseLog();
  } else if (name === "chain") {
    await chain();
  } else if (name === "deploy-contracts") {
    await deployContracts();
  } else if (name === "review-service") {
    await runReviewService();
  } else if (name === "review-runner") {
    await runReviewRunner();
  } else if (name === "api") {
    await runApi();
  } else if (name === "indexer") {
    await runIndexer();
  } else if (name === "app") {
    await runApp();
  } else if (name === "postgres-ready") {
    process.exit((await postgresReady()) ? 0 : 1);
  } else if (name === "rpc-ready") {
    process.exit((await rpcReady()) ? 0 : 1);
  } else if (name === "review-ready") {
    process.exit((await urlOk(`${aiReviewBaseUrl}/ready`)) ? 0 : 1);
  } else if (name === "api-ready") {
    process.exit((await urlOk(`${apiBaseUrl}/health`)) ? 0 : 1);
  } else if (name === "indexer-ready") {
    process.exit(existsSync(healthFile) ? 0 : 1);
  } else if (name === "app-ready") {
    process.exit((await urlOk(`${appBaseUrl}/create`)) ? 0 : 1);
  }
}

function printUsage() {
  console.log(`Usage: pnpm run local:dev:control -- [options] [process...]

Start the Pop Charts local dev stack through the local control-plane config.

Options:
  --keep-db          Preserve local Postgres rows when starting a fresh chain.
  --no-ai-review    Start app/API/indexer/chain/database without review workers.
  --ai-review-only  Start only Postgres, the review service, and the runner.
  -h, --help        Show this help.

Selected processes can be passed through for focused debugging, for example:
  pnpm run local:dev:control -- app
  pnpm run local:dev:control -- review-service review-runner

Environment overrides:
  LOCAL_APP_PORT=3000
  LOCAL_API_PORT=3001
  LOCAL_AI_REVIEW_PORT=3002
  LOCAL_AI_REVIEW_PROVIDER=heuristic
  LOCAL_AI_REVIEW_INTERNET_ACCESS=off
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/popcharts`);
}

async function prepareDatabase() {
  console.log("[local-dev-control] preparing local database");
  ensureDependenciesInstalled();
  rmSync(healthFile, { force: true });

  const reuseExistingHardhatRpc = await rpcReady();
  if (
    !reuseExistingHardhatRpc &&
    process.env.POPCHARTS_LOCAL_DEV_KEEP_DB !== "true"
  ) {
    await resetLocalPostgresForFreshChain();
  } else if (!reuseExistingHardhatRpc) {
    console.warn(
      "[local-dev-control] --keep-db was passed while starting a fresh Hardhat chain. " +
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
}

async function databaseLog() {
  await waitFor("Postgres readiness", () => postgresReady(), {
    timeoutMs: 30_000,
  });

  await inherit("docker", ["logs", "--follow", POSTGRES_CONTAINER_NAME], {
    env: process.env,
  });
}

async function chain() {
  if (await rpcReady()) {
    console.log(
      `[local-dev-control] using existing Hardhat RPC at ${rpcHttpUrl}`,
    );
    while (await rpcReady()) {
      await sleep(1_000);
    }

    throw new Error(
      `Existing Hardhat RPC at ${rpcHttpUrl} stopped responding.`,
    );
  }

  await inherit("pnpm", [
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

async function deployContracts() {
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

  console.log("[local-dev-control] local protocol deployed");
  console.log(`- API: ${apiBaseUrl}/markets?chainId=${deploy.chainId}`);
  console.log(`- Hardhat RPC: ${rpcHttpUrl}`);
  console.log(`- PregradManager: ${deploy.pregradManagerAddress}`);
  console.log(`- Collateral: ${deploy.collateralAddress}`);
  console.log(`- App env: ${appEnvFile}`);
  console.log(`- Server env: ${serverEnvFile}`);
}

async function runReviewService() {
  await inherit(
    "bun",
    ["run", "--cwd", "server", "start:ai-review"],
    { env: buildAiReviewEnv(buildServerEnv()) },
  );
}

async function runReviewRunner() {
  await inherit(
    "bun",
    ["run", "--cwd", "server", "start:ai-review-runner"],
    { env: buildAiReviewRunnerEnv(buildServerEnv()) },
  );
}

async function runApi() {
  await inherit("bun", ["run", "--cwd", "server", "start:api"], {
    env: readGeneratedServerEnv(),
  });
}

async function runIndexer() {
  await inherit("bun", ["run", "--cwd", "server", "start:indexer"], {
    env: readGeneratedServerEnv(),
  });
}

async function runApp() {
  await inherit("pnpm", [
    "--dir",
    "app",
    "exec",
    "next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    appPort,
  ]);
}

async function ensureToolInstalled() {
  if (await commandSucceeds("process-compose", ["version"])) {
    return;
  }

  throw new Error(
    "process-compose is required for this spike. Install it with " +
      "'brew install f1bonacc1/tap/process-compose' or see " +
      "https://f1bonacc1.github.io/process-compose/installation/.",
  );
}

async function resetLocalPostgresForFreshChain() {
  console.log(
    "[local-dev-control] no existing Hardhat RPC; clearing local Postgres " +
      "so the projection matches the fresh chain",
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
    `Missing ${missing.join(", ")}. Run 'just setup' before 'just local-dev-control'.`,
  );
}

async function ensurePostgres() {
  if (await dockerContainerExists(POSTGRES_CONTAINER_NAME)) {
    const volumeNames = await dockerContainerVolumeNames(
      POSTGRES_CONTAINER_NAME,
    );

    if (!volumeNames.includes(POSTGRES_VOLUME_NAME)) {
      console.log(
        `[local-dev-control] existing ${POSTGRES_CONTAINER_NAME} uses ${formatVolumeNames(
          volumeNames,
        )}; expected ${POSTGRES_VOLUME_NAME}`,
      );
      await removeDockerContainerAndVolumes(POSTGRES_CONTAINER_NAME);
    } else {
      console.log(
        `[local-dev-control] using existing Docker container ${POSTGRES_CONTAINER_NAME}`,
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
  await waitFor("Postgres readiness", () => postgresReady());
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

  console.log(`[local-dev-control] removing stale Docker volume ${volumeName}`);
  await run("postgres", "docker", ["volume", "rm", "-f", volumeName], {
    cwd: repoRoot,
  });
}

async function removeDockerContainerAndVolumes(name) {
  const volumeNames = await dockerContainerVolumeNames(name);

  console.log(`[local-dev-control] removing stale Docker container ${name}`);
  await run("postgres", "docker", ["rm", "-f", name], {
    cwd: repoRoot,
  });

  for (const volumeName of volumeNames) {
    console.log(
      `[local-dev-control] removing stale Docker volume ${volumeName}`,
    );
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
    "# Generated by scripts/local-dev-control.mjs.",
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

function readGeneratedServerEnv() {
  if (!existsSync(serverEnvFile)) {
    throw new Error(
      `Missing ${serverEnvFile}. Wait for deploy-contracts to complete, ` +
        "or rerun the control plane.",
    );
  }

  return {
    ...process.env,
    ...readEnvFile(serverEnvFile),
  };
}

function readEnvFile(path) {
  const env = {};
  const text = readFileSync(path, "utf8");

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    env[key] = value;
  }

  return env;
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

async function run(name, command, args, options = {}) {
  console.log(`\n[local-dev-control] ${name}: ${command} ${args.join(" ")}`);

  return await collect(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    name,
    print: true,
    rejectOnFailure: true,
  });
}

async function inherit(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
  });
  let stopping = false;

  const stop = () => {
    stopping = true;
    child.kill("SIGTERM");
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const code = await new Promise((resolveCode, reject) => {
    child.on("error", reject);
    child.on("exit", (exitCode, signal) => {
      if (exitCode !== null) {
        resolveCode(exitCode);
      } else if (stopping || signal === "SIGINT" || signal === "SIGTERM") {
        resolveCode(0);
      } else {
        resolveCode(1);
      }
    });
  });

  if (code !== 0) {
    process.exit(code);
  }
}

async function commandSucceeds(command, args, env = process.env) {
  let result;

  try {
    result = await collect(command, args, {
      cwd: repoRoot,
      env,
      print: false,
      rejectOnFailure: false,
    });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }

  return result.code === 0;
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
    try {
      const value = await predicate();

      if (value) {
        console.log(`[local-dev-control] ${label} ready`);
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
