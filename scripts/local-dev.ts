#!/usr/bin/env -S node --experimental-strip-types

import { existsSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildAiReviewEnv } from "./shared/aiReview/buildAiReviewEnv.ts";
import { buildAiReviewRunnerEnv } from "./shared/aiReview/buildAiReviewRunnerEnv.ts";
import { localAiReviewBaseUrl } from "./shared/aiReview/localAiReviewEndpoint.ts";
import { localAiReviewRunnerPollMs } from "./shared/aiReview/localAiReviewRunnerPollMs.ts";
import { DEFAULT_HARDHAT_PRIVATE_KEY as DEFAULT_LOCAL_CHAIN_PRIVATE_KEY } from "./shared/chain/defaultHardhatPrivateKey.ts";
import { DEMO_MARKET_SYMBOL } from "./shared/deployments/demoMarket.ts";
import {
  parsePregradDeploy,
  type PregradDeploy,
} from "./shared/deployments/pregradDeploy.ts";
import {
  readPostgradDeployment,
  type PostgradDeployment,
} from "./shared/deployments/readPostgradDeployment.ts";
import { POSTGRES_VOLUME_NAME } from "./shared/docker/dockerComposeEnv.ts";
import { ensureLocalPostgres } from "./shared/docker/ensureLocalPostgres.ts";
import { resetLocalPostgresForFreshChain } from "./shared/docker/resetLocalPostgresForFreshChain.ts";
import { buildLocalAppEnv } from "./shared/env/buildLocalAppEnv.ts";
import { buildLocalServerEnv } from "./shared/env/buildLocalServerEnv.ts";
import {
  postgradServerEnv,
  postgradServerEnvLines,
} from "./shared/env/postgradEnv.ts";
import {
  appLocalDevEnvFile,
  localDevIndexerHealthFile,
} from "./shared/env/localDevEnvFiles.ts";
import { writeEnvMarkerBlock } from "./shared/env/writeEnvMarkerBlock.ts";
import { resolveAndRegisterStack } from "./shared/localStack/resolveAndRegisterStack.ts";
import { isRpcReady } from "./shared/net/isRpcReady.ts";
import { urlOk } from "./shared/net/urlOk.ts";
import { appDir, protocolDir, repoRoot, serverDir } from "./shared/paths.ts";
import { collectCommand } from "./shared/process/collectCommand.ts";
import {
  createProcessSupervisor,
  type SupervisedProcess,
} from "./shared/process/processSupervisor.ts";
import { waitFor } from "./shared/wait/waitFor.ts";

/**
 * Full local dev orchestrator: docker-compose Postgres, Hardhat chain, local
 * protocol deployment (pregrad + postgrad venue + demo market), Bun API and
 * indexer, the local AI review service/runner, and the Next.js app wired for
 * devchain market creation. Everything runs until Ctrl-C, and a crashed
 * child takes the stack down loudly instead of leaving it half-alive.
 */

const LOG_LABEL = "local-dev";
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const helpRequested = args.includes("--help") || args.includes("-h");
const aiReviewOnly = args.includes("--ai-review-only");
const noAiReview = args.includes("--no-ai-review");
const aiReviewEnabled = aiReviewOnly || !noAiReview;
const keepDb = args.includes("--keep-db");
const noPostgrad = args.includes("--no-postgrad");
const { resources } = await resolveAndRegisterStack(process.cwd());

const databaseUrl =
  process.env.DATABASE_URL ??
  `postgresql://postgres:postgres@localhost:5433/${resources.dbName}`;
const rpcHost = "127.0.0.1";
const rpcPort = String(resources.chainPort);
const rpcHttpUrl = resources.chainRpcHttpUrl;
const apiPort = process.env.LOCAL_API_PORT ?? String(resources.apiPort);
const appPort = process.env.LOCAL_APP_PORT ?? String(resources.appPort);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const appBaseUrl = `http://127.0.0.1:${appPort}`;
const aiReviewBaseUrl = localAiReviewBaseUrl(resources);

const supervisor = createProcessSupervisor({
  cwd: repoRoot,
  logLabel: LOG_LABEL,
});

if (helpRequested) {
  printUsage();
  process.exit(0);
}

process.on("SIGINT", () => {
  void supervisor.shutdown(130);
});
process.on("SIGTERM", () => {
  void supervisor.shutdown(143);
});

main().catch(async (error: unknown) => {
  console.error(
    `\n[${LOG_LABEL}] ${error instanceof Error ? error.message : error}`,
  );
  await supervisor.shutdown(1);
});

async function main(): Promise<void> {
  console.log(
    aiReviewOnly
      ? "=== Pop Charts local AI review stack ===\n"
      : "=== Pop Charts local dev stack ===\n",
  );
  rejectUnknownArgs();
  rejectConflictingArgs();
  ensureDependenciesInstalled();

  rmSync(localDevIndexerHealthFile, { force: true });

  // Reusing a live Hardhat RPC keeps existing chain state, so the database
  // rows still match. A fresh chain invalidates old rows unless --keep-db
  // explicitly accepts the mismatch.
  const reuseExistingChainRpc = !aiReviewOnly && (await rpcReady());
  await ensureLocalPostgres({
    cwd: repoRoot,
    dbName: resources.dbName,
    expectedVolumeName: POSTGRES_VOLUME_NAME,
    logLabel: LOG_LABEL,
  });

  if (!aiReviewOnly && !reuseExistingChainRpc && !keepDb) {
    await resetLocalPostgresForFreshChain({
      cwd: repoRoot,
      dbName: resources.dbName,
      logLabel: LOG_LABEL,
    });
  } else if (!aiReviewOnly && !reuseExistingChainRpc && keepDb) {
    console.warn(
      "[local-dev] --keep-db was passed while starting a fresh Hardhat chain. " +
        "Old local market rows may not match the new chain.",
    );
  }

  const initialServerEnv = buildLocalServerEnv(resources);
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

  if (aiReviewOnly) {
    const aiReviewProcesses = await startAiReviewStack(initialServerEnv);

    console.log("\nLocal AI review stack is ready:");
    console.log(`- AI Review service: ${aiReviewBaseUrl}`);
    console.log(`- AI Review readiness: ${aiReviewBaseUrl}/ready`);
    console.log(
      `- Runner: polling Postgres every ${localAiReviewRunnerPollMs()}ms`,
    );
    console.log(`- Database: ${databaseUrl}`);
    console.log("\nPress Ctrl-C to stop the AI review service and runner.");

    await supervisor.waitForever(aiReviewProcesses);
    return;
  }

  let localChainNode: SupervisedProcess | null = null;
  if (reuseExistingChainRpc) {
    console.log(`[local-dev] using existing Hardhat RPC at ${rpcHttpUrl}`);
  } else {
    localChainNode = supervisor.start("chain", "pnpm", [
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

  await waitForWithProcesses("Hardhat RPC", () => rpcReady(), {
    processes: localChainNode ? [localChainNode] : [],
    timeoutMs: 45_000,
  });

  const deployOutput = await run("deploy", "pnpm", [
    "--dir",
    "protocol",
    "run",
    "local:deploy-pregrad",
  ]);
  const deploy = parsePregradDeploy(deployOutput.stdout);
  const postgrad = noPostgrad ? null : await deployPostgradVenue(deploy);
  // The supervised server processes receive this object directly (not the
  // generated env file), so the venue addresses must be merged here for the
  // API's venue reads and the keeper to see them.
  const serverEnv = {
    ...buildLocalServerEnv(resources, {
      collateralAddress: deploy.collateralAddress,
      deployBlock: deploy.deployBlock,
      postgradAdapterAddress: deploy.postgradAdapterAddress,
      pregradManagerAddress: deploy.pregradManagerAddress,
    }),
    ...postgradServerEnv(postgrad),
  };
  const appEnv = buildLocalAppEnv({ apiBaseUrl, deploy, postgrad, rpcHttpUrl });
  writeServerEnv(serverEnv, deploy, postgrad);
  writeEnvMarkerBlock({ env: appEnv, filePath: appLocalDevEnvFile });

  const aiReviewProcesses = aiReviewEnabled
    ? await startAiReviewStack(serverEnv)
    : [];

  const api = supervisor.start(
    "api",
    "bun",
    ["run", "--cwd", "server", "start:api"],
    {
      env: serverEnv,
    },
  );
  await waitForWithProcesses(
    "API health",
    () => urlOk(`${apiBaseUrl}/health`),
    {
      processes: [api],
      timeoutMs: 30_000,
    },
  );

  const indexer = supervisor.start(
    "indexer",
    "bun",
    ["run", "--cwd", "server", "start:indexer"],
    {
      env: serverEnv,
    },
  );
  await waitForWithProcesses(
    "Indexer health marker",
    () => existsSync(localDevIndexerHealthFile),
    {
      processes: [api, indexer],
      timeoutMs: 45_000,
    },
  );

  // The venue keeper needs the postgrad venue contracts; skip it in
  // --no-postgrad runs where none are deployed.
  if (postgrad !== null) {
    supervisor.start(
      "keeper",
      "bun",
      ["run", "--cwd", "server", "start:keeper"],
      {
        env: serverEnv,
      },
    );
  }

  const app = supervisor.start(
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
  await waitForWithProcesses(
    "Next.js app",
    () => urlOk(`${appBaseUrl}/create`),
    {
      processes: [
        api,
        indexer,
        app,
        ...aiReviewProcesses,
        ...(localChainNode ? [localChainNode] : []),
      ],
      timeoutMs: 120_000,
    },
  );

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
  if (postgrad !== null) {
    console.log(`- PoolManager: ${postgrad.poolManager}`);
    console.log(`- StateView: ${postgrad.stateView}`);
    console.log(`- Quoter: ${postgrad.quoter}`);
    console.log(`- SwapRouter: ${postgrad.swapRouter}`);
    console.log(`- PoolTickBounds: ${postgrad.poolTickBounds}`);
    console.log(`- OrderManager: ${postgrad.orderManager}`);
    console.log(`- BoundedHook: ${postgrad.boundedHook}`);
    console.log(`- PostgradAdapter: ${postgrad.postgradAdapter}`);
    console.log(
      `- Demo market (${postgrad.marketSymbol}): ${postgrad.marketAddress}`,
    );
    console.log(
      `- Demo market YES/NO tokens: ${postgrad.yesTokenAddress} / ${postgrad.noTokenAddress}`,
    );
    console.log(`- Demo market YES pool: ${postgrad.yesPoolId}`);
    console.log(`- Demo market NO pool: ${postgrad.noPoolId}`);
  } else {
    console.log("- Postgrad venue: skipped (--no-postgrad)");
  }
  console.log(`- App env: ${appLocalDevEnvFile}`);
  console.log(`- Server env: ${resources.envFilePath}`);
  console.log(
    "\nPress Ctrl-C to stop API, indexer, app, AI review, and local chain.",
  );

  await supervisor.waitForever([
    api,
    indexer,
    app,
    ...aiReviewProcesses,
    ...(localChainNode ? [localChainNode] : []),
  ]);
}

function printUsage(): void {
  console.log(`Usage: pnpm run local:dev
       pnpm run local:dev -- --no-ai-review
       pnpm run local:dev -- --keep-db
       pnpm run local:dev -- --no-postgrad
       pnpm run local:ai-review

Start the full local Pop Charts stack:
  - docker-compose Postgres
  - Hardhat local chain
  - local PregradManager and MockCollateral deployment
  - local v4 venue stack, postgrad venue, and one ${DEMO_MARKET_SYMBOL} demo
    complete-set market (skip with --no-postgrad)
  - Bun API server
  - Bun indexer
  - local AI Review service and durable runner using the Ollama provider;
    temporary provider failures remain pending and retry automatically
  - Next.js app configured for devchain market creation

Prerequisite for local model review:
  ollama pull gpt-oss:20b   # AI_REVIEW_OLLAMA_MODEL default
  Without it, reviews remain pending and retry until the model is available or
  the job exhausts its retry budget.

Environment overrides:
  LOCAL_APP_PORT=3000
  LOCAL_API_PORT=3001
  LOCAL_AI_REVIEW_PORT=3002
  LOCAL_AI_REVIEW_PROVIDER=ollama
  LOCAL_AI_REVIEW_INTERNET_ACCESS=search
  LOCAL_AI_REVIEW_TIMEOUT_MS=300000
  LOCAL_AI_REVIEW_RUNNER_REQUEST_TIMEOUT_MS=360000
  LOCAL_AI_REVIEW_RUNNER_LEASE_MS=600000
  LOCAL_AI_REVIEW_RETRY_PROVIDER_FAILURES=true
  LOCAL_AI_REVIEW_FALLBACK_APPROVE=false
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/${resources.dbName}`);
}

function rejectUnknownArgs(): void {
  const knownArgs = new Set([
    "--ai-review-only",
    "--help",
    "--keep-db",
    "--no-ai-review",
    "--no-postgrad",
    "-h",
  ]);
  const unknownArgs = args.filter((arg) => !knownArgs.has(arg));

  if (unknownArgs.length > 0) {
    throw new Error(
      `Unknown option(s): ${unknownArgs.join(", ")}. Use --help.`,
    );
  }
}

function rejectConflictingArgs(): void {
  if (aiReviewOnly && noAiReview) {
    throw new Error("--ai-review-only cannot be combined with --no-ai-review.");
  }
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
    `Missing ${missing.join(", ")}. Run 'just setup' before 'just local-dev'.`,
  );
}

async function startAiReviewStack(
  serverEnv: NodeJS.ProcessEnv,
): Promise<SupervisedProcess[]> {
  const aiReview = supervisor.start(
    "ai-review",
    "bun",
    ["run", "--cwd", "server", "start:ai-review"],
    {
      env: buildAiReviewEnv(serverEnv, resources),
    },
  );

  await waitForWithProcesses(
    "AI Review service readiness",
    () => urlOk(`${aiReviewBaseUrl}/ready`),
    {
      processes: [aiReview],
      timeoutMs: 30_000,
    },
  );

  const runner = supervisor.start(
    "ai-review-runner",
    "bun",
    ["run", "--cwd", "server", "start:ai-review-runner"],
    {
      env: buildAiReviewRunnerEnv(serverEnv, resources),
    },
  );

  return [aiReview, runner];
}

// Deploys the postgrad venue on top of the fresh pregrad deployment: the v4
// venue stack, the complete-set postgrad contracts, and one demo market so the
// venue is immediately tradeable. The deploy scripts are idempotent against a
// reused chain (the venue deploy clears stale Ignition journals itself), and
// every failure rejects loudly through run().
async function deployPostgradVenue(
  deploy: PregradDeploy,
): Promise<PostgradDeployment> {
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

  return readPostgradDeployment(DEMO_MARKET_SYMBOL);
}

function writeServerEnv(
  env: NodeJS.ProcessEnv,
  deploy: PregradDeploy,
  postgrad: PostgradDeployment | null,
): void {
  const lines = [
    "# Generated by scripts/local-dev.ts.",
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

  writeFileSync(resources.envFilePath, lines.join("\n"));
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

async function waitForWithProcesses<T>(
  label: string,
  predicate: () => Promise<T | null | undefined | false> | T,
  options: {
    readonly processes: readonly SupervisedProcess[];
    readonly timeoutMs?: number;
  },
): Promise<T> {
  // If a supervised child exits while we are waiting for a downstream
  // condition, surface that as the primary failure instead of timing out
  // with stale context.
  return waitFor(label, predicate, {
    ensure: () => supervisor.assertRunning(options.processes),
    logLabel: LOG_LABEL,
    timeoutMs: options.timeoutMs,
  });
}

async function rpcReady(): Promise<boolean> {
  return isRpcReady(rpcHttpUrl);
}
