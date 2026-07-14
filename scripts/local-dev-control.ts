#!/usr/bin/env -S node --experimental-strip-types

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildAiResolutionEnv } from "./shared/aiResolution/buildAiResolutionEnv.ts";
import { buildAiResolutionRunnerEnv } from "./shared/aiResolution/buildAiResolutionRunnerEnv.ts";
import { localAiResolutionBaseUrl } from "./shared/aiResolution/localAiResolutionEndpoint.ts";
import { buildAiReviewEnv } from "./shared/aiReview/buildAiReviewEnv.ts";
import { buildAiReviewRunnerEnv } from "./shared/aiReview/buildAiReviewRunnerEnv.ts";
import { localAiReviewBaseUrl } from "./shared/aiReview/localAiReviewEndpoint.ts";
import { DEFAULT_HARDHAT_PRIVATE_KEY } from "./shared/chain/defaultHardhatPrivateKey.ts";
import { DEMO_MARKET_SYMBOL } from "./shared/deployments/demoMarket.ts";
import {
  parsePregradDeploy,
  type PregradDeploy,
} from "./shared/deployments/pregradDeploy.ts";
import {
  readPostgradDeployment,
  type PostgradDeployment,
} from "./shared/deployments/readPostgradDeployment.ts";
import {
  POSTGRES_CONTAINER_NAME,
  POSTGRES_VOLUME_NAME,
} from "./shared/docker/dockerComposeEnv.ts";
import { ensureLocalPostgres } from "./shared/docker/ensureLocalPostgres.ts";
import { resetLocalPostgresForFreshChain } from "./shared/docker/resetLocalPostgresForFreshChain.ts";
import { buildLocalServerEnv } from "./shared/env/buildLocalServerEnv.ts";
import {
  postgradAppEnv,
  postgradServerEnvLines,
} from "./shared/env/postgradEnv.ts";
import {
  appLocalDevEnvFile,
  localChainEnvFile,
  localDevIndexerHealthFile,
} from "./shared/env/localDevEnvFiles.ts";
import { readEnvFile } from "./shared/env/readEnvFile.ts";
import { writeEnvMarkerBlock } from "./shared/env/writeEnvMarkerBlock.ts";
import { isRpcReady } from "./shared/net/isRpcReady.ts";
import { urlOk } from "./shared/net/urlOk.ts";
import { appDir, protocolDir, repoRoot, serverDir } from "./shared/paths.ts";
import { collectCommand } from "./shared/process/collectCommand.ts";
import { commandSucceeds } from "./shared/process/commandSucceeds.ts";
import { sleep } from "./shared/wait/sleep.ts";
import { waitFor } from "./shared/wait/waitFor.ts";

/**
 * process-compose control plane for the local dev stack. Without an internal
 * command it launches process-compose with the repo's control-plane config;
 * with one of the internal command names (used by that config) it runs a
 * single process or readiness probe so every service gets its own log pane.
 */

const LOG_LABEL = "local-dev-control";
const CONTROL_FILE = resolve(repoRoot, "local-dev.control-plane.yaml");
const rpcHost = "127.0.0.1";
const rpcPort = "8545";
const rpcHttpUrl = `http://${rpcHost}:${rpcPort}`;
const apiPort = process.env.LOCAL_API_PORT ?? "3001";
const appPort = process.env.LOCAL_APP_PORT ?? "3000";
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const appBaseUrl = `http://127.0.0.1:${appPort}`;
const aiReviewBaseUrl = localAiReviewBaseUrl;
const aiResolutionBaseUrl = localAiResolutionBaseUrl;

const processComposeConfigDir = resolve(
  repoRoot,
  ".local-dev",
  "config",
  "process-compose",
);
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
  "keeper",
  "postgres-ready",
  "prepare-database",
  "resolution-ready",
  "resolution-runner",
  "resolution-service",
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

if (command !== undefined && internalCommands.has(command)) {
  runInternal(command).catch((error: unknown) => {
    console.error(
      `[${LOG_LABEL}] ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  });
} else {
  startControlPlane(
    [command, ...args].filter((arg): arg is string => Boolean(arg)),
  ).catch((error: unknown) => {
    console.error(
      `[${LOG_LABEL}] ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  });
}

async function startControlPlane(rawArgs: readonly string[]): Promise<void> {
  const passthrough: string[] = [];
  const env: NodeJS.ProcessEnv = { ...process.env };
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

  mkdirSync(processComposeConfigDir, { recursive: true });
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
      ? `[${LOG_LABEL}] starting ${selectedProcesses.join(", ")}`
      : `[${LOG_LABEL}] starting full stack`,
  );
  console.log(`[${LOG_LABEL}] press ? in the TUI for keyboard help\n`);

  await inherit("process-compose", processArgs, {
    env: withProcessComposeHome(env),
  });
}

async function runInternal(name: string): Promise<void> {
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
  } else if (name === "resolution-service") {
    await runResolutionService();
  } else if (name === "resolution-runner") {
    await runResolutionRunner();
  } else if (name === "api") {
    await runApi();
  } else if (name === "indexer") {
    await runIndexer();
  } else if (name === "keeper") {
    await runKeeper();
  } else if (name === "app") {
    await runApp();
  } else if (name === "postgres-ready") {
    process.exit((await postgresReady()) ? 0 : 1);
  } else if (name === "rpc-ready") {
    process.exit((await isRpcReady(rpcHttpUrl)) ? 0 : 1);
  } else if (name === "review-ready") {
    process.exit((await probeUrl(`${aiReviewBaseUrl}/ready`)) ? 0 : 1);
  } else if (name === "resolution-ready") {
    process.exit((await probeUrl(`${aiResolutionBaseUrl}/ready`)) ? 0 : 1);
  } else if (name === "api-ready") {
    process.exit((await probeUrl(`${apiBaseUrl}/health`)) ? 0 : 1);
  } else if (name === "indexer-ready") {
    process.exit(existsSync(localDevIndexerHealthFile) ? 0 : 1);
  } else if (name === "app-ready") {
    process.exit((await probeUrl(`${appBaseUrl}/create`)) ? 0 : 1);
  }
}

function printUsage(): void {
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

Prerequisite for model-backed review:
  ollama pull gpt-oss:20b   # AI_REVIEW_OLLAMA_MODEL default
  Transient provider failures stay pending and retry instead of creating a
  completed heuristic review.

Environment overrides:
  LOCAL_APP_PORT=3000
  LOCAL_API_PORT=3001
  LOCAL_AI_REVIEW_PORT=3002
  LOCAL_AI_REVIEW_PROVIDER=ollama
  LOCAL_AI_REVIEW_INTERNET_ACCESS=search
  LOCAL_AI_REVIEW_FALLBACK_APPROVE=false
  LOCAL_AI_REVIEW_RETRY_PROVIDER_FAILURES=true
  LOCAL_AI_REVIEW_TIMEOUT_MS=300000
  LOCAL_AI_REVIEW_RUNNER_REQUEST_TIMEOUT_MS=360000
  LOCAL_AI_REVIEW_RUNNER_LEASE_MS=600000
  LOCAL_AI_RESOLUTION_PORT=3004
  LOCAL_AI_RESOLUTION_PROVIDER=heuristic
  LOCAL_AI_RESOLUTION_INTERNET_ACCESS=off
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/popcharts`);
}

async function prepareDatabase(): Promise<void> {
  console.log(`[${LOG_LABEL}] preparing local database`);
  ensureDependenciesInstalled();
  rmSync(localDevIndexerHealthFile, { force: true });

  const reuseExistingHardhatRpc = await isRpcReady(rpcHttpUrl);
  if (!reuseExistingHardhatRpc) {
    // A fresh chain invalidates previously deployed addresses; drop the stale
    // generated env so review-runner waits for the new deployment instead of
    // signing transitions against contracts that no longer exist.
    rmSync(localChainEnvFile, { force: true });
  }
  if (
    !reuseExistingHardhatRpc &&
    process.env.POPCHARTS_LOCAL_DEV_KEEP_DB !== "true"
  ) {
    await resetLocalPostgresForFreshChain({
      cwd: repoRoot,
      logLabel: LOG_LABEL,
    });
  } else if (!reuseExistingHardhatRpc) {
    console.warn(
      `[${LOG_LABEL}] --keep-db was passed while starting a fresh Hardhat chain. ` +
        "Old local market rows may not match the new chain.",
    );
  }

  await ensureLocalPostgres({
    cwd: repoRoot,
    expectedVolumeName: POSTGRES_VOLUME_NAME,
    logLabel: LOG_LABEL,
  });

  const initialServerEnv = buildLocalServerEnv();
  await run(
    "db constraints",
    "bun",
    ["run", "--cwd", "server", "db:ensure-local-constraints"],
    {
      env: initialServerEnv,
    },
  );
  await run("db", "bun", ["run", "--cwd", "server", "db:push"], {
    env: initialServerEnv,
  });
}

async function databaseLog(): Promise<void> {
  await waitFor("Postgres readiness", () => postgresReady(), {
    logLabel: LOG_LABEL,
    timeoutMs: 30_000,
  });

  await inherit("docker", ["logs", "--follow", POSTGRES_CONTAINER_NAME], {
    env: process.env,
  });
}

async function chain(): Promise<void> {
  // Reuse an already-running Hardhat node (e.g. from another orchestrator)
  // and stay alive as its stand-in so process-compose keeps this pane; if
  // that external node dies, fail loudly instead of silently taking over.
  if (await isRpcReady(rpcHttpUrl)) {
    console.log(`[${LOG_LABEL}] using existing Hardhat RPC at ${rpcHttpUrl}`);
    while (await isRpcReady(rpcHttpUrl)) {
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

async function deployContracts(): Promise<void> {
  const deployOutput = await run("deploy", "pnpm", [
    "--dir",
    "protocol",
    "run",
    "local:deploy-pregrad",
  ]);
  const deploy = parsePregradDeploy(deployOutput.stdout);

  // The postgrad venue rides the same fresh chain so graduated markets can
  // wire straight into live v4 pools: venue stack, bounded-order contracts,
  // and one demo complete-set market that proves the venue trades.
  await run("venue", "pnpm", [
    "--dir",
    "protocol",
    "run",
    "local:deploy-venue",
  ]);
  await run(
    "postgrad",
    "pnpm",
    ["--dir", "protocol", "run", "local:deploy-postgrad"],
    {
      env: { POPCHARTS_PREGRAD_MANAGER_ADDRESS: deploy.pregradManagerAddress },
    },
  );
  await run(
    "demo market",
    "pnpm",
    ["--dir", "protocol", "run", "local:create-complete-set-market"],
    {
      env: {
        POPCHARTS_COLLATERAL_ADDRESS: deploy.collateralAddress,
        POPCHARTS_MARKET_SYMBOL: DEMO_MARKET_SYMBOL,
      },
    },
  );
  const postgrad = readPostgradDeployment(DEMO_MARKET_SYMBOL);

  const serverEnv = buildLocalServerEnv({
    collateralAddress: deploy.collateralAddress,
    deployBlock: deploy.deployBlock,
    postgradAdapterAddress: deploy.postgradAdapterAddress,
    pregradManagerAddress: deploy.pregradManagerAddress,
  });
  const appEnv = { ...buildAppEnv(deploy), ...postgradAppEnv(postgrad) };

  writeServerEnv(serverEnv, deploy, postgrad);
  writeEnvMarkerBlock({ env: appEnv, filePath: appLocalDevEnvFile });

  console.log(`[${LOG_LABEL}] local protocol deployed`);
  console.log(`- API: ${apiBaseUrl}/markets?chainId=${deploy.chainId}`);
  console.log(`- Hardhat RPC: ${rpcHttpUrl}`);
  console.log(`- PregradManager: ${deploy.pregradManagerAddress}`);
  console.log(`- Postgrad adapter: ${postgrad.postgradAdapter}`);
  console.log(`- Pool manager: ${postgrad.poolManager}`);
  console.log(`- Bounded hook: ${postgrad.boundedHook}`);
  console.log(`- Collateral: ${deploy.collateralAddress}`);
  console.log(`- App env: ${appLocalDevEnvFile}`);
  console.log(`- Server env: ${localChainEnvFile}`);
}

async function runReviewService(): Promise<void> {
  await inherit("bun", ["run", "--cwd", "server", "start:ai-review"], {
    env: buildAiReviewEnv(buildLocalServerEnv()),
  });
}

async function runReviewRunner(): Promise<void> {
  // The runner submits approve/reject transitions to the PregradManager, so
  // unlike the review service it cannot run on the blank pre-deploy addresses
  // from buildLocalServerEnv. Wait for deploy-contracts to write the generated
  // env (or reuse one from an attached chain) instead of a yaml dependency,
  // which would drag chain + deploy-contracts into --ai-review-only.
  await waitFor(
    "generated server env from deploy-contracts",
    () => existsSync(localChainEnvFile),
    { logLabel: LOG_LABEL, timeoutMs: 600_000 },
  );

  await inherit("bun", ["run", "--cwd", "server", "start:ai-review-runner"], {
    env: buildAiReviewRunnerEnv(readGeneratedServerEnv()),
  });
}

async function runResolutionService(): Promise<void> {
  await inherit("bun", ["run", "--cwd", "server", "start:ai-resolution"], {
    env: buildAiResolutionEnv(buildLocalServerEnv()),
  });
}

async function runResolutionRunner(): Promise<void> {
  // Like the review runner, the resolution runner submits on-chain transactions
  // (resolve/cancel to the postgrad market), so it needs the generated env from
  // deploy-contracts rather than the blank pre-deploy addresses.
  await waitFor(
    "generated server env from deploy-contracts",
    () => existsSync(localChainEnvFile),
    { logLabel: LOG_LABEL, timeoutMs: 600_000 },
  );

  await inherit(
    "bun",
    ["run", "--cwd", "server", "start:ai-resolution-runner"],
    { env: buildAiResolutionRunnerEnv(readGeneratedServerEnv()) },
  );
}

async function runApi(): Promise<void> {
  await inherit("bun", ["run", "--cwd", "server", "start:api"], {
    env: readGeneratedServerEnv(),
  });
}

async function runIndexer(): Promise<void> {
  await inherit("bun", ["run", "--cwd", "server", "start:indexer"], {
    env: readGeneratedServerEnv(),
  });
}

async function runKeeper(): Promise<void> {
  await inherit("bun", ["run", "--cwd", "server", "start:keeper"], {
    env: readGeneratedServerEnv(),
  });
}

async function runApp(): Promise<void> {
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

async function ensureToolInstalled(): Promise<void> {
  if (await processComposeInstalled()) {
    return;
  }

  throw new Error(
    "process-compose is required for this spike. Install it with " +
      "'brew install f1bonacc1/tap/process-compose' or see " +
      "https://f1bonacc1.github.io/process-compose/installation/.",
  );
}

async function processComposeInstalled(): Promise<boolean> {
  // A missing binary surfaces as a spawn ENOENT rather than a nonzero exit;
  // treat both as "not installed" so the caller prints install guidance.
  try {
    return await commandSucceeds("process-compose", ["version"], {
      cwd: repoRoot,
      env: withProcessComposeHome(),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function withProcessComposeHome(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
    XDG_CONFIG_HOME: resolve(repoRoot, ".local-dev", "config"),
  };
}

function ensureDependenciesInstalled(): void {
  const missing: string[] = [];

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

async function postgresReady(): Promise<boolean> {
  return commandSucceeds(
    "docker",
    [
      "exec",
      POSTGRES_CONTAINER_NAME,
      "psql",
      "-U",
      "postgres",
      "-d",
      "popcharts",
      "-c",
      "select 1",
    ],
    { cwd: repoRoot },
  );
}

function buildAppEnv(deploy: PregradDeploy): Record<string, string> {
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

function writeServerEnv(
  env: NodeJS.ProcessEnv,
  deploy: PregradDeploy,
  postgrad: PostgradDeployment | null,
): void {
  const lines = [
    "# Generated by scripts/local-dev-control.ts.",
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
    `LOCAL_POSTGRAD_ADAPTER_ADDRESS=${deploy.postgradAdapterAddress}`,
    ...postgradServerEnvLines(postgrad),
    `HEALTH_CHECK_FILE=${env.HEALTH_CHECK_FILE}`,
    "",
  ];

  writeFileSync(localChainEnvFile, lines.join("\n"));
}

function readGeneratedServerEnv(): NodeJS.ProcessEnv {
  if (!existsSync(localChainEnvFile)) {
    throw new Error(
      `Missing ${localChainEnvFile}. Wait for deploy-contracts to complete, ` +
        "or rerun the control plane.",
    );
  }

  return {
    ...process.env,
    ...readEnvFile(localChainEnvFile),
  };
}

async function run(
  name: string,
  command: string,
  commandArgs: readonly string[],
  options: { readonly env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string }> {
  console.log(`\n[${LOG_LABEL}] ${name}: ${command} ${commandArgs.join(" ")}`);

  return await collectCommand(command, commandArgs, {
    cwd: repoRoot,
    echoPrefix: name,
    env: { ...process.env, ...options.env },
    rejectOnFailure: true,
  });
}

// process-compose stops panes with SIGTERM/SIGINT during shutdown; treat a
// signal-terminated child as success so orderly teardown does not report a
// failed process, and mirror any real nonzero exit as this wrapper's own.
async function inherit(
  command: string,
  commandArgs: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): Promise<void> {
  const child = spawn(command, [...commandArgs], {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
  });
  let stopping = false;

  const stop = (): void => {
    stopping = true;
    child.kill("SIGTERM");
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const code = await new Promise<number>((resolveCode, reject) => {
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

async function probeUrl(url: string): Promise<boolean> {
  // Readiness probes run repeatedly while services boot; connection errors
  // simply mean "not ready yet".
  try {
    return await urlOk(url);
  } catch {
    return false;
  }
}
