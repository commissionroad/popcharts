#!/usr/bin/env -S node --experimental-strip-types

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { buildAiReviewEnv } from "./shared/aiReview/buildAiReviewEnv.ts";
import { buildAiReviewRunnerEnv } from "./shared/aiReview/buildAiReviewRunnerEnv.ts";
import { localAiReviewBaseUrl } from "./shared/aiReview/localAiReviewEndpoint.ts";
import { buildAiResolutionEnv } from "./shared/aiResolution/buildAiResolutionEnv.ts";
import { buildAiResolutionRunnerEnv } from "./shared/aiResolution/buildAiResolutionRunnerEnv.ts";
import { localAiResolutionBaseUrl } from "./shared/aiResolution/localAiResolutionEndpoint.ts";
import { deployPostgradVenue } from "./shared/deployments/deployPostgradVenue.ts";
import { parsePregradDeploy } from "./shared/deployments/pregradDeploy.ts";
import { POSTGRES_VOLUME_NAME } from "./shared/docker/dockerComposeEnv.ts";
import { ensureLocalPostgres } from "./shared/docker/ensureLocalPostgres.ts";
import { resetLocalPostgresForFreshChain } from "./shared/docker/resetLocalPostgresForFreshChain.ts";
import { buildLocalServerEnv } from "./shared/env/buildLocalServerEnv.ts";
import { localDevIndexerHealthFile } from "./shared/env/localDevEnvFiles.ts";
import { postgradServerEnv } from "./shared/env/postgradEnv.ts";
import { writeLocalChainServerEnv } from "./shared/env/writeLocalChainServerEnv.ts";
import { resolveAndRegisterStack } from "./shared/localStack/resolveAndRegisterStack.ts";
import { isRpcReady } from "./shared/net/isRpcReady.ts";
import { urlOk } from "./shared/net/urlOk.ts";
import { protocolDir, repoRoot, serverDir } from "./shared/paths.ts";
import { collectCommand } from "./shared/process/collectCommand.ts";
import {
  createProcessSupervisor,
  type SupervisedProcess,
} from "./shared/process/processSupervisor.ts";
import { waitFor } from "./shared/wait/waitFor.ts";

/**
 * Boot-once orchestrator for the lifecycle nightly suite (ADR 0017 Track C
 * item C3). Boots the complete service/chain stack — Postgres, Hardhat
 * chain, protocol deployment, API, indexer, venue keeper, and the AI review
 * and resolution service/runner pairs — then hands the live stack to the
 * scenario runner (`server nightly:lifecycle`), which drives markets through
 * every lifecycle path and asserts the money paper trail. No app: this is
 * the service/chain layer (the UI journeys are ADR 0017 item C4).
 *
 * Both AI providers are pinned to the deterministic heuristic: nightly
 * lifecycle reds must mean lifecycle regressions, never model variance (the
 * AI-quality lane is ADR 0019 / Track C item C5).
 */

const LOG_LABEL = "lifecycle-nightly";
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const helpRequested = args.includes("--help") || args.includes("-h");
const keepRunning = args.includes("--keep-running");
const keepDb = args.includes("--keep-db");
const scenarioFilter = readScenarioFilter(args);
const { resources } = await resolveAndRegisterStack(process.cwd());

const rpcHost = "127.0.0.1";
const rpcPort = String(resources.chainPort);
const rpcHttpUrl = resources.chainRpcHttpUrl;
const apiBaseUrl = `http://127.0.0.1:${process.env.LOCAL_API_PORT ?? resources.apiPort}`;

// Deterministic offline providers for both AI services; explicit LOCAL_*
// overrides still win for debugging runs.
process.env.LOCAL_AI_REVIEW_PROVIDER ??= "heuristic";
process.env.LOCAL_AI_REVIEW_INTERNET_ACCESS ??= "off";
process.env.LOCAL_AI_RESOLUTION_PROVIDER ??= "heuristic";

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
  console.log("=== Pop Charts lifecycle nightly suite ===\n");
  rejectUnknownArgs();
  ensureDependenciesInstalled();

  rmSync(localDevIndexerHealthFile, { force: true });

  // Reusing a live Hardhat RPC keeps existing chain state so the database
  // rows still match; a fresh chain resets the database unless --keep-db
  // explicitly accepts the mismatch. Scenario assertions are market-scoped,
  // so reused (dirty) chain and database state cannot affect verdicts.
  const reuseExistingChainRpc = await isRpcReady(rpcHttpUrl);
  await ensureLocalPostgres({
    cwd: repoRoot,
    dbName: resources.dbName,
    expectedVolumeName: POSTGRES_VOLUME_NAME,
    logLabel: LOG_LABEL,
  });

  if (!reuseExistingChainRpc && !keepDb) {
    await resetLocalPostgresForFreshChain({
      cwd: repoRoot,
      dbName: resources.dbName,
      logLabel: LOG_LABEL,
    });
  }

  const initialServerEnv = buildLocalServerEnv(resources);
  await run(
    "db constraints",
    "bun",
    ["run", "--cwd", "server", "db:ensure-local-constraints"],
    { env: initialServerEnv },
  );
  await run("db", "bun", ["run", "--cwd", "server", "db:push"], {
    env: initialServerEnv,
  });

  let localChainNode: SupervisedProcess | null = null;
  if (reuseExistingChainRpc) {
    console.log(`[${LOG_LABEL}] using existing Hardhat RPC at ${rpcHttpUrl}`);
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
  await waitForWithProcesses("Hardhat RPC", () => isRpcReady(rpcHttpUrl), {
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
  const postgrad = await deployPostgradVenue(run, deploy);

  const serverEnv = {
    ...buildLocalServerEnv(resources, {
      collateralAddress: deploy.collateralAddress,
      deployBlock: deploy.deployBlock,
      postgradAdapterAddress: deploy.postgradAdapterAddress,
      pregradManagerAddress: deploy.pregradManagerAddress,
    }),
    ...postgradServerEnv(postgrad),
  };
  writeLocalChainServerEnv({
    deploy,
    env: serverEnv,
    envFilePath: resources.envFilePath,
    generatedBy: "scripts/local-lifecycle-nightly.ts",
    postgrad,
  });

  const api = supervisor.start(
    "api",
    "bun",
    ["run", "--cwd", "server", "start:api"],
    { env: serverEnv },
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
    { env: serverEnv },
  );
  await waitForWithProcesses(
    "Indexer health marker",
    () => existsSync(localDevIndexerHealthFile),
    {
      processes: [api, indexer],
      timeoutMs: 45_000,
    },
  );

  const keeper = supervisor.start(
    "keeper",
    "bun",
    ["run", "--cwd", "server", "start:keeper"],
    { env: serverEnv },
  );

  const aiProcesses = await startAiServices(serverEnv);
  const stackProcesses = [
    api,
    indexer,
    keeper,
    ...aiProcesses,
    ...(localChainNode ? [localChainNode] : []),
  ];

  console.log(`\n[${LOG_LABEL}] stack is up; running scenarios\n`);

  let scenariosFailed = false;
  try {
    await run(
      "scenarios",
      "bun",
      ["run", "--cwd", "server", "nightly:lifecycle"],
      {
        env: {
          ...serverEnv,
          POPCHARTS_LOCAL_CHAIN_ENV_FILE: resources.envFilePath,
          ...(scenarioFilter
            ? { POPCHARTS_LIFECYCLE_SCENARIO: scenarioFilter }
            : {}),
        },
      },
    );
  } catch (error) {
    scenariosFailed = true;
    console.error(
      `\n[${LOG_LABEL}] scenarios FAILED: ${error instanceof Error ? error.message : error}`,
    );
  }

  if (keepRunning) {
    console.log(
      `\n[${LOG_LABEL}] --keep-running: stack stays up for inspection ` +
        `(scenarios ${scenariosFailed ? "FAILED" : "passed"}). Press Ctrl-C to stop.`,
    );
    console.log(`- API: ${apiBaseUrl}`);
    console.log(`- Hardhat RPC: ${rpcHttpUrl}`);
    console.log(`- Server env: ${resources.envFilePath}`);
    await supervisor.waitForever(stackProcesses);
    return;
  }

  await supervisor.shutdown(scenariosFailed ? 1 : 0);
}

async function startAiServices(
  serverEnv: NodeJS.ProcessEnv,
): Promise<SupervisedProcess[]> {
  const reviewService = supervisor.start(
    "ai-review",
    "bun",
    ["run", "--cwd", "server", "start:ai-review"],
    { env: buildAiReviewEnv(serverEnv, resources) },
  );
  await waitForWithProcesses(
    "AI review service readiness",
    () => urlOk(`${localAiReviewBaseUrl(resources)}/ready`),
    { processes: [reviewService], timeoutMs: 30_000 },
  );
  const reviewRunner = supervisor.start(
    "ai-review-runner",
    "bun",
    ["run", "--cwd", "server", "start:ai-review-runner"],
    { env: buildAiReviewRunnerEnv(serverEnv, resources) },
  );

  const resolutionService = supervisor.start(
    "ai-resolution",
    "bun",
    ["run", "--cwd", "server", "start:ai-resolution"],
    { env: buildAiResolutionEnv(serverEnv, resources) },
  );
  await waitForWithProcesses(
    "AI resolution service readiness",
    () => urlOk(`${localAiResolutionBaseUrl(resources)}/ready`),
    { processes: [resolutionService], timeoutMs: 30_000 },
  );
  const resolutionRunner = supervisor.start(
    "ai-resolution-runner",
    "bun",
    ["run", "--cwd", "server", "start:ai-resolution-runner"],
    { env: buildAiResolutionRunnerEnv(serverEnv, resources) },
  );

  return [reviewService, reviewRunner, resolutionService, resolutionRunner];
}

function printUsage(): void {
  console.log(`Usage: pnpm run local:lifecycle-nightly -- [options]

Boot the full local stack (chain, contracts, Postgres, API, indexer, keeper,
heuristic AI review + resolution services and runners) and run the lifecycle
nightly scenarios against it (ADR 0017 Track C / ADR 0014 checklist).

Options:
  --scenario <name>  Run a single scenario by name (default: all, in order).
  --keep-running     Keep the stack up after the scenarios finish or fail.
  --keep-db          Keep existing database rows when starting a fresh chain.
  -h, --help         Show this help.`);
}

function readScenarioFilter(argv: readonly string[]): string | null {
  const index = argv.indexOf("--scenario");

  if (index === -1) {
    const inline = argv.find((arg) => arg.startsWith("--scenario="));
    return inline ? inline.slice("--scenario=".length) : null;
  }

  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--scenario requires a scenario name.");
  }
  return value;
}

function rejectUnknownArgs(): void {
  const knownFlags = new Set(["--help", "--keep-db", "--keep-running", "-h"]);
  const unknownArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;

    if (arg === "--scenario") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--scenario=") || knownFlags.has(arg)) {
      continue;
    }
    unknownArgs.push(arg);
  }

  if (unknownArgs.length > 0) {
    throw new Error(
      `Unknown option(s): ${unknownArgs.join(", ")}. Use --help.`,
    );
  }
}

function ensureDependenciesInstalled(): void {
  const missing: string[] = [];

  if (!existsSync(resolve(protocolDir, "node_modules"))) {
    missing.push("protocol/node_modules");
  }
  if (!existsSync(resolve(serverDir, "node_modules"))) {
    missing.push("server/node_modules");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(" and ")}. Run 'just setup' first.`,
    );
  }
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
