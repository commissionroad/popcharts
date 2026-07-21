#!/usr/bin/env -S node --experimental-strip-types

import { existsSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { DEMO_MARKET_SYMBOL } from "./shared/deployments/demoMarket.ts";
import { deployPostgradVenue } from "./shared/deployments/deployPostgradVenue.ts";
import {
  parsePregradDeploy,
  type PregradDeploy,
} from "./shared/deployments/pregradDeploy.ts";
import {
  parseSmokeMarket,
  type SmokeMarket,
} from "./shared/deployments/smokeMarket.ts";
import { type PostgradDeployment } from "./shared/deployments/readPostgradDeployment.ts";
import { ensureLocalPostgres } from "./shared/docker/ensureLocalPostgres.ts";
import { resetLocalPostgresForFreshChain } from "./shared/docker/resetLocalPostgresForFreshChain.ts";
import { localChainEnvFileForSlot } from "./shared/env/localDevEnvFiles.ts";
import { postgradServerEnv } from "./shared/env/postgradEnv.ts";
import { resolveAndRegisterStack } from "./shared/localStack/resolveAndRegisterStack.ts";
import { SMOKE_READINESS_LINE } from "./shared/localStack/smokeReadinessLine.ts";
import { isRpcReady } from "./shared/net/isRpcReady.ts";
import { urlOk } from "./shared/net/urlOk.ts";
import { collectCommand } from "./shared/process/collectCommand.ts";
import {
  createProcessSupervisor,
  type SupervisedProcess,
} from "./shared/process/processSupervisor.ts";
import { protocolDir, repoRoot, serverDir } from "./shared/paths.ts";
import { waitFor } from "./shared/wait/waitFor.ts";

/**
 * End-to-end local smoke: deploys the protocol (pregrad, v4 venue stack,
 * postgrad venue, demo complete-set market), starts Postgres/API/indexer,
 * creates a market onchain, and asserts the public read API serves it.
 *
 * This script intentionally orchestrates the whole server/indexer path
 * instead of mocking anything: Postgres, Hardhat, the API, the indexer, and
 * one onchain market creation all run together so regressions show up at the
 * boundary.
 */

const LOG_LABEL = "local-smoke";
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const keepRunning = args.includes("--keep-running");
const freshDb = args.includes("--fresh-db");
const helpRequested = args.includes("--help") || args.includes("-h");
const { resources } = await resolveAndRegisterStack(process.cwd());
const databaseUrl =
  process.env.DATABASE_URL ??
  `postgresql://postgres:postgres@localhost:5433/${resources.dbName}`;

// Keep local service addresses deterministic so docs, env files, and polling
// URLs line up with the default developer setup.
const rpcHost = "127.0.0.1";
const rpcPort = String(resources.chainPort);
const rpcHttpUrl = resources.chainRpcHttpUrl;
const rpcWssUrl = resources.chainRpcWssUrl;
const apiPort =
  process.env.PORT ?? process.env.LOCAL_API_PORT ?? String(resources.apiPort);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

// The smoke writes these under server/ so a developer can reuse the exact same
// deployed addresses after a successful run with --keep-running.
const envFile = localChainEnvFileForSlot(resources.slot);
const healthFile = resolve(serverDir, ".env.local-chain.indexer-health");

type IndexedMarket = {
  createdTransactionHash: string;
  marketId: string;
  metadata?: { metadataHash?: string };
  metadataHash: string;
};

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
  console.log("=== Pop Charts local chain/server smoke ===\n");
  rejectUnknownArgs();
  ensureDependenciesInstalled();

  // A previous interrupted run may have left the health marker behind. Remove
  // it so this run proves the newly started indexer reached healthy state.
  rmSync(healthFile, { force: true });

  await ensureLocalPostgres({
    cwd: repoRoot,
    dbName: resources.dbName,
    logLabel: LOG_LABEL,
  });

  // The smoke always boots a fresh chain, so a database kept from an earlier
  // run holds stale projections whose status guards block re-projection of
  // this chain's events (same market ids, earlier statuses). Lifecycle
  // orchestration passes --fresh-db to start both sides from genesis.
  if (freshDb) {
    await resetLocalPostgresForFreshChain({
      cwd: repoRoot,
      dbName: resources.dbName,
      logLabel: LOG_LABEL,
    });
  }

  // db:push keeps the smoke useful while migrations are evolving. The schema's
  // additive defaults keep this non-interactive against existing local data.
  const serverEnv = buildServerEnv();
  await run("db", "bun", ["run", "--cwd", "server", "db:push"], {
    env: serverEnv,
  });

  // Hardhat's local node is the chain source for both the deploy helper and the
  // server indexer. The explicit host/port make HTTP and WS URLs predictable.
  const localChainNode = supervisor.start("chain", "pnpm", [
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
  await waitForWithProcesses("Hardhat RPC", () => isRpcReady(rpcHttpUrl), {
    processes: [localChainNode],
    timeoutMs: 45_000,
  });

  // Deploy contracts before starting the server/indexer so the server can boot
  // with the actual manager address and deploy block in its environment.
  const deployOutput = await run("deploy", "pnpm", [
    "--dir",
    "protocol",
    "run",
    "local:deploy-pregrad",
  ]);
  const deploy = parsePregradDeploy(deployOutput.stdout);
  // The postgrad venue rides the same fresh chain so the smoke proves the
  // whole system deploys end-to-end: v4 venue stack, postgrad contracts, and
  // one demo complete-set market that makes the venue immediately tradeable.
  // The helper reads the deploy manifests as its machine-readable output
  // instead of parsing human stdout for addresses.
  const postgrad = await deployPostgradVenue(run, deploy);

  // The read-only health check walks market status, collateral escrow, pool
  // prices, bounds, and whitelisting against the manifest — a cheap
  // whole-system verification that the venue actually works, not merely that
  // the deploy transactions landed.
  await run(
    "market health",
    "pnpm",
    ["--dir", "protocol", "run", "local:check-health"],
    {
      env: { POPCHARTS_MARKET_SYMBOL: DEMO_MARKET_SYMBOL },
    },
  );

  // Venue addresses ride along so the indexer runs the postgrad watcher set
  // (outcome-token transfers, pool ticks, resolution events) — without them
  // graduated-market balances never index and portfolio reads stay empty.
  const configuredServerEnv = {
    ...buildServerEnv({
      collateralAddress: deploy.collateralAddress,
      deployBlock: deploy.deployBlock,
      postgradAdapterAddress: deploy.postgradAdapterAddress,
      pregradManagerAddress: deploy.pregradManagerAddress,
    }),
    ...postgradServerEnv(postgrad),
  };
  writeLocalEnv(configuredServerEnv, deploy, postgrad);

  // The API is checked first because the final assertion goes through the
  // public read endpoint, not a direct database query.
  const api = supervisor.start(
    "api",
    "bun",
    ["run", "--cwd", "server", "start:api"],
    {
      env: configuredServerEnv,
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

  // The indexer writes a health marker once it has recovered any missed events
  // and subscribed to live MarketCreated logs. That is stronger than merely
  // checking that the process has started.
  const indexer = supervisor.start(
    "indexer",
    "bun",
    ["run", "--cwd", "server", "start:indexer"],
    {
      env: configuredServerEnv,
    },
  );
  await waitForWithProcesses(
    "Indexer health marker",
    () => existsSync(healthFile),
    {
      processes: [indexer],
      timeoutMs: 45_000,
    },
  );

  // Create the market after the indexer subscription is healthy. This ensures
  // the smoke exercises the real-time event path instead of only recovery.
  const marketOutput = await run(
    "market",
    "pnpm",
    ["--dir", "protocol", "run", "local:create-market"],
    {
      env: configuredServerEnv,
    },
  );
  const market = parseSmokeMarket(marketOutput.stdout);

  // Poll the same read API the frontend will use. Matching by market ID and
  // metadata hash proves the event was decoded, persisted, projected, and served
  // rather than only observing that some market exists. Requiring metadata proves
  // direct contract creation emitted enough information for indexer recovery.
  const indexedMarket = await waitForWithProcesses(
    `GET /markets includes market ${market.marketId}`,
    () => findIndexedMarket(market),
    {
      processes: [api, indexer, localChainNode],
      timeoutMs: 45_000,
    },
  );

  console.log("\nSmoke verification passed:");
  console.log(`- PregradManager: ${deploy.pregradManagerAddress}`);
  console.log(`- Collateral: ${deploy.collateralAddress}`);
  console.log(`- PoolManager: ${postgrad.poolManager}`);
  console.log(`- OrderManager: ${postgrad.orderManager}`);
  console.log(`- BoundedHook: ${postgrad.boundedHook}`);
  console.log(`- PostgradAdapter: ${postgrad.postgradAdapter}`);
  console.log(
    `- Demo market (${postgrad.marketSymbol}): ${postgrad.marketAddress}`,
  );
  console.log(`- Market ID: ${market.marketId}`);
  console.log(`- Metadata hash: ${market.metadataHash}`);
  console.log(`- API: ${apiBaseUrl}/markets?chainId=${market.chainId}`);
  console.log(`- Env file: ${envFile}`);
  console.log(`- Indexed tx: ${indexedMarket.createdTransactionHash}`);

  if (keepRunning) {
    console.log(
      `\n${SMOKE_READINESS_LINE}. Press Ctrl-C to stop.`,
    );
    await new Promise(() => {});
  }

  await supervisor.shutdown(0);
}

function printUsage(): void {
  console.log(`Usage: pnpm run local:smoke -- [--keep-running]

Deploy local protocol contracts (pregrad, v4 venue stack, postgrad venue, and
one ${DEMO_MARKET_SYMBOL} demo complete-set market), verify market health,
start Postgres/API/indexer, create a market, and verify that
GET /markets?chainId=31337 returns the indexed market.

Options:
  --keep-running  Keep Hardhat, API, and indexer running after verification.
  --fresh-db      Recreate this stack's database before indexing (fresh chain).
  -h, --help      Show this help.`);
}

function rejectUnknownArgs(): void {
  // Keep this script deliberately small: one mode and one lifecycle flag. More
  // flags tend to hide setup drift that the smoke is supposed to catch.
  const unknownArgs = args.filter(
    (arg) => arg !== "--keep-running" && arg !== "--fresh-db",
  );

  if (unknownArgs.length > 0) {
    throw new Error(
      `Unknown option(s): ${unknownArgs.join(", ")}. Use --help.`,
    );
  }
}

function ensureDependenciesInstalled(): void {
  // Fail before Docker or ports are touched. Missing dependencies produce noisy
  // secondary failures once several child processes are running.
  const missing: string[] = [];

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
    `Missing ${missing.join(
      " and ",
    )}. Run 'just setup' before 'just local-smoke'.`,
  );
}

function buildServerEnv(
  overrides: Partial<Omit<PregradDeploy, "chainId">> = {},
): NodeJS.ProcessEnv {
  // Before deployment, address values are blank so db:push can run with the
  // same DATABASE_URL. After deployment, overrides fill in the chain addresses
  // used by both the API and indexer.
  return {
    DATABASE_URL: databaseUrl,
    HEALTH_CHECK_FILE: healthFile,
    LOCAL_COLLATERAL_ADDRESS: overrides.collateralAddress ?? "",
    LOCAL_POSTGRAD_ADAPTER_ADDRESS: overrides.postgradAdapterAddress ?? "",
    LOCAL_PREGRAD_MANAGER_ADDRESS: overrides.pregradManagerAddress ?? "",
    LOCAL_PREGRAD_MANAGER_DEPLOY_BLOCK: overrides.deployBlock ?? "0",
    NETWORK: "local",
    PORT: apiPort,
    // The lifecycle e2e lane drives graduation/resolution through the local
    // dev endpoints; they are local-network-only and additionally gated on
    // this flag, so the smoke API opts in explicitly.
    POPCHARTS_DEV_TOOLS_ENABLED: "true",
    PREGRAD_MANAGER_ADDRESS: overrides.pregradManagerAddress ?? "",
    PREGRAD_MANAGER_DEPLOY_BLOCK: overrides.deployBlock ?? "0",
    RPC_HTTP_URL: rpcHttpUrl,
    RPC_WSS_URL: rpcWssUrl,
  };
}

function writeLocalEnv(
  env: NodeJS.ProcessEnv,
  deploy: PregradDeploy,
  postgrad: PostgradDeployment,
): void {
  // The generated file is not sourced by this script; it is a convenience for a
  // developer who wants to inspect or manually restart the same local setup.
  const lines = [
    "# Generated by scripts/local-chain-smoke.ts.",
    "# Safe to delete; ignored by git.",
    `DATABASE_URL=${env.DATABASE_URL}`,
    `PORT=${env.PORT}`,
    "NETWORK=local",
    `RPC_HTTP_URL=${env.RPC_HTTP_URL}`,
    `RPC_WSS_URL=${env.RPC_WSS_URL}`,
    `PREGRAD_MANAGER_ADDRESS=${deploy.pregradManagerAddress}`,
    `PREGRAD_MANAGER_DEPLOY_BLOCK=${deploy.deployBlock}`,
    `LOCAL_PREGRAD_MANAGER_ADDRESS=${deploy.pregradManagerAddress}`,
    `LOCAL_PREGRAD_MANAGER_DEPLOY_BLOCK=${deploy.deployBlock}`,
    `LOCAL_COLLATERAL_ADDRESS=${deploy.collateralAddress}`,
    `LOCAL_POSTGRAD_ADAPTER_ADDRESS=${deploy.postgradAdapterAddress}`,
    ...postgradEnvLines(postgrad),
    `HEALTH_CHECK_FILE=${env.HEALTH_CHECK_FILE}`,
    "",
  ];

  writeFileSync(envFile, lines.join("\n"));
}

// The server does not consume these keys yet; they document the local postgrad
// venue deployment for the upcoming server/app integration.
function postgradEnvLines(postgrad: PostgradDeployment): string[] {
  return [
    `POOL_MANAGER_ADDRESS=${postgrad.poolManager}`,
    `STATE_VIEW_ADDRESS=${postgrad.stateView}`,
    `QUOTER_ADDRESS=${postgrad.quoter}`,
    `SWAP_ROUTER_ADDRESS=${postgrad.swapRouter}`,
    `POOL_TICK_BOUNDS_ADDRESS=${postgrad.poolTickBounds}`,
    `ORDER_MANAGER_ADDRESS=${postgrad.orderManager}`,
    `BOUNDED_HOOK_ADDRESS=${postgrad.boundedHook}`,
    `POSTGRAD_ADAPTER_ADDRESS=${postgrad.postgradAdapter}`,
    `COMPLETE_SET_MARKET_ADDRESS=${postgrad.marketAddress}`,
    `COMPLETE_SET_MARKET_SYMBOL=${postgrad.marketSymbol}`,
    `COMPLETE_SET_YES_TOKEN_ADDRESS=${postgrad.yesTokenAddress}`,
    `COMPLETE_SET_NO_TOKEN_ADDRESS=${postgrad.noTokenAddress}`,
    `COMPLETE_SET_YES_POOL_ID=${postgrad.yesPoolId}`,
    `COMPLETE_SET_NO_POOL_ID=${postgrad.noPoolId}`,
    `LOCAL_POOL_MANAGER_ADDRESS=${postgrad.poolManager}`,
    `LOCAL_STATE_VIEW_ADDRESS=${postgrad.stateView}`,
    `LOCAL_QUOTER_ADDRESS=${postgrad.quoter}`,
    `LOCAL_SWAP_ROUTER_ADDRESS=${postgrad.swapRouter}`,
    `LOCAL_POOL_TICK_BOUNDS_ADDRESS=${postgrad.poolTickBounds}`,
    `LOCAL_ORDER_MANAGER_ADDRESS=${postgrad.orderManager}`,
    `LOCAL_BOUNDED_HOOK_ADDRESS=${postgrad.boundedHook}`,
    `LOCAL_POSTGRAD_ADAPTER_ADDRESS=${postgrad.postgradAdapter}`,
    `LOCAL_COMPLETE_SET_MARKET_ADDRESS=${postgrad.marketAddress}`,
    `LOCAL_COMPLETE_SET_MARKET_SYMBOL=${postgrad.marketSymbol}`,
    `LOCAL_COMPLETE_SET_YES_TOKEN_ADDRESS=${postgrad.yesTokenAddress}`,
    `LOCAL_COMPLETE_SET_NO_TOKEN_ADDRESS=${postgrad.noTokenAddress}`,
    `LOCAL_COMPLETE_SET_YES_POOL_ID=${postgrad.yesPoolId}`,
    `LOCAL_COMPLETE_SET_NO_POOL_ID=${postgrad.noPoolId}`,
  ];
}

async function run(
  name: string,
  command: string,
  args: readonly string[],
  options: { readonly env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string }> {
  // Short-lived commands are collected so their labeled JSON can be parsed
  // after the command exits.
  console.log(`\n[${LOG_LABEL}] ${name}: ${command} ${args.join(" ")}`);

  return await collectCommand(command, args, {
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

async function findIndexedMarket(
  market: SmokeMarket,
): Promise<IndexedMarket | undefined> {
  const response = await fetch(
    `${apiBaseUrl}/markets?chainId=${market.chainId}`,
  );

  if (!response.ok) {
    return undefined;
  }

  const markets = (await response.json()) as IndexedMarket[];

  // The market ID alone is deterministic on each fresh Hardhat run. The metadata
  // hash ties the API row to the market created by this particular smoke attempt.
  return markets.find(
    (row) =>
      row.marketId === market.marketId &&
      row.metadataHash.toLowerCase() === market.metadataHash.toLowerCase() &&
      row.metadata?.metadataHash?.toLowerCase() ===
        market.metadataHash.toLowerCase(),
  );
}
