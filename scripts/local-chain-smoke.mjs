#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protocolDir = resolve(repoRoot, "protocol");
const serverDir = resolve(repoRoot, "server");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const POSTGRES_CONTAINER_NAME = "popcharts-postgres";

// This script intentionally orchestrates the whole server/indexer path instead
// of mocking anything: Postgres, Hardhat, the API, the indexer, and one onchain
// market creation all run together so regressions show up at the boundary.
const keepRunning = args.includes("--keep-running");
const helpRequested = args.includes("--help") || args.includes("-h");
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5433/popcharts";

// Keep local service addresses deterministic so docs, env files, and polling
// URLs line up with the default developer setup.
const rpcHost = "127.0.0.1";
const rpcPort = "8545";
const rpcHttpUrl = `http://${rpcHost}:${rpcPort}`;
const rpcWssUrl = `ws://${rpcHost}:${rpcPort}`;
const apiPort = process.env.PORT ?? process.env.LOCAL_API_PORT ?? "3001";
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

// The smoke writes these under server/ so a developer can reuse the exact same
// deployed addresses after a successful run with --keep-running.
const envFile = resolve(serverDir, ".env.local-chain");
const healthFile = resolve(serverDir, ".env.local-chain.indexer-health");
const children = new Set();

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
  console.error(`\n[local-smoke] ${error.message}`);
  await shutdown(1);
});

async function main() {
  console.log("=== Pop Charts local chain/server smoke ===\n");
  rejectUnknownArgs();
  ensureDependenciesInstalled();

  // A previous interrupted run may have left the health marker behind. Remove
  // it so this run proves the newly started indexer reached healthy state.
  rmSync(healthFile, { force: true });

  // Postgres is the only long-lived dependency we leave running. Existing local
  // containers may have been created by another worktree, so reuse the
  // deterministic container name before asking Compose to create one.
  await ensurePostgres();

  // db:push keeps the smoke useful while migrations are evolving. The schema's
  // additive defaults keep this non-interactive against existing local data.
  const serverEnv = buildServerEnv();
  await run("db", "bun", ["run", "--cwd", "server", "db:push"], {
    cwd: repoRoot,
    env: serverEnv,
  });

  // Hardhat's local node is the chain source for both the deploy helper and the
  // server indexer. The explicit host/port make HTTP and WS URLs predictable.
  const hardhatNode = start("hardhat", "pnpm", [
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
  await waitFor("Hardhat RPC", () => rpcReady(), {
    processes: [hardhatNode],
    timeoutMs: 45_000,
  });

  // Deploy contracts before starting the server/indexer so the server can boot
  // with the actual manager address and deploy block in its environment.
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
  const configuredServerEnv = buildServerEnv({
    collateralAddress: deploy.collateralAddress,
    deployBlock: deploy.deployBlock,
    pregradManagerAddress: deploy.pregradManagerAddress,
  });
  writeLocalEnv(configuredServerEnv, deploy);

  // The API is checked first because the final assertion goes through the
  // public read endpoint, not a direct database query.
  const api = start("api", "bun", ["run", "--cwd", "server", "start:api"], {
    env: configuredServerEnv,
  });
  await waitFor("API health", () => urlOk(`${apiBaseUrl}/health`), {
    processes: [api],
    timeoutMs: 30_000,
  });

  // The indexer writes a health marker once it has recovered any missed events
  // and subscribed to live MarketCreated logs. That is stronger than merely
  // checking that the process has started.
  const indexer = start(
    "indexer",
    "bun",
    ["run", "--cwd", "server", "start:indexer"],
    {
      env: configuredServerEnv,
    },
  );
  await waitFor("Indexer health marker", () => existsSync(healthFile), {
    processes: [indexer],
    timeoutMs: 45_000,
  });

  // Create the market after the indexer subscription is healthy. This ensures
  // the smoke exercises the real-time event path instead of only recovery.
  const marketOutput = await run(
    "market",
    "pnpm",
    ["--dir", "protocol", "run", "local:create-market"],
    {
      cwd: repoRoot,
      env: configuredServerEnv,
    },
  );
  const market = parseLabeledJson(
    marketOutput.stdout,
    "LOCAL_CHAIN_SMOKE_MARKET",
  );

  // Poll the same read API the frontend will use. Matching by market ID and
  // metadata hash proves the event was decoded, persisted, projected, and served
  // rather than only observing that some market exists. Requiring metadata proves
  // direct contract creation emitted enough information for indexer recovery.
  const indexedMarket = await waitFor(
    `GET /markets includes market ${market.marketId}`,
    () => findIndexedMarket(market),
    {
      processes: [api, indexer, hardhatNode],
      timeoutMs: 45_000,
    },
  );

  console.log("\nSmoke verification passed:");
  console.log(`- PregradManager: ${deploy.pregradManagerAddress}`);
  console.log(`- Collateral: ${deploy.collateralAddress}`);
  console.log(`- Market ID: ${market.marketId}`);
  console.log(`- Metadata hash: ${market.metadataHash}`);
  console.log(`- API: ${apiBaseUrl}/markets?chainId=${market.chainId}`);
  console.log(`- Env file: ${envFile}`);
  console.log(`- Indexed tx: ${indexedMarket.createdTransactionHash}`);

  if (keepRunning) {
    console.log(
      "\nKeeping Hardhat, API, and indexer running. Press Ctrl-C to stop.",
    );
    await new Promise(() => {});
  }

  await shutdown(0);
}

function printUsage() {
  console.log(`Usage: pnpm run local:smoke -- [--keep-running]

Deploy local protocol contracts, start Postgres/API/indexer, create a market,
and verify that GET /markets?chainId=31337 returns the indexed market.

Options:
  --keep-running  Keep Hardhat, API, and indexer running after verification.
  -h, --help      Show this help.`);
}

function rejectUnknownArgs() {
  // Keep this script deliberately small: one mode and one lifecycle flag. More
  // flags tend to hide setup drift that the smoke is supposed to catch.
  const unknownArgs = args.filter((arg) => arg !== "--keep-running");

  if (unknownArgs.length > 0) {
    throw new Error(
      `Unknown option(s): ${unknownArgs.join(", ")}. Use --help.`,
    );
  }
}

function ensureDependenciesInstalled() {
  // Fail before Docker or ports are touched. Missing dependencies produce noisy
  // secondary failures once several child processes are running.
  const missing = [];

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

async function ensurePostgres() {
  if (await dockerContainerExists(POSTGRES_CONTAINER_NAME)) {
    console.log(
      `[local-smoke] using existing Docker container ${POSTGRES_CONTAINER_NAME}`,
    );
    await run("postgres", "docker", ["start", POSTGRES_CONTAINER_NAME], {
      cwd: repoRoot,
    });
    await waitFor("Postgres readiness", () =>
      commandSucceeds("docker", [
        "exec",
        POSTGRES_CONTAINER_NAME,
        "pg_isready",
        "-U",
        "postgres",
        "-d",
        "popcharts",
      ]),
    );
    return;
  }

  await run("postgres", "docker", ["compose", "up", "-d", "postgres"], {
    cwd: repoRoot,
  });
  await waitFor("Postgres readiness", () =>
    commandSucceeds("docker", [
      "compose",
      "exec",
      "-T",
      "postgres",
      "pg_isready",
      "-U",
      "postgres",
      "-d",
      "popcharts",
    ]),
  );
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

function buildServerEnv(overrides = {}) {
  // Before deployment, address values are blank so db:push can run with the
  // same DATABASE_URL. After deployment, overrides fill in the chain addresses
  // used by both the API and indexer.
  return {
    DATABASE_URL: databaseUrl,
    HEALTH_CHECK_FILE: healthFile,
    LOCAL_COLLATERAL_ADDRESS: overrides.collateralAddress ?? "",
    LOCAL_PREGRAD_MANAGER_ADDRESS: overrides.pregradManagerAddress ?? "",
    LOCAL_PREGRAD_MANAGER_DEPLOY_BLOCK: overrides.deployBlock ?? "0",
    NETWORK: "local",
    PORT: apiPort,
    PREGRAD_MANAGER_ADDRESS: overrides.pregradManagerAddress ?? "",
    PREGRAD_MANAGER_DEPLOY_BLOCK: overrides.deployBlock ?? "0",
    RPC_HTTP_URL: rpcHttpUrl,
    RPC_WSS_URL: rpcWssUrl,
  };
}

function writeLocalEnv(env, deploy) {
  // The generated file is not sourced by this script; it is a convenience for a
  // developer who wants to inspect or manually restart the same local setup.
  const lines = [
    "# Generated by scripts/local-chain-smoke.mjs.",
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
    `HEALTH_CHECK_FILE=${env.HEALTH_CHECK_FILE}`,
    "",
  ];

  writeFileSync(envFile, lines.join("\n"));
}

function start(name, command, args, options = {}) {
  // Long-running child processes are tracked so any failure or Ctrl-C tears down
  // Hardhat/API/indexer in reverse start order.
  console.log(`\n[local-smoke] starting ${name}: ${command} ${args.join(" ")}`);
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
  // Short-lived commands are collected so their labeled JSON can be parsed after
  // the command exits.
  console.log(`\n[local-smoke] ${name}: ${command} ${args.join(" ")}`);

  return await collect(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    name,
    print: true,
    rejectOnFailure: true,
  });
}

async function commandSucceeds(command, args) {
  // Readiness checks should keep polling quietly until they pass or time out.
  const result = await collect(command, args, {
    cwd: repoRoot,
    env: process.env,
    print: false,
    rejectOnFailure: false,
  });

  return result.code === 0;
}

async function collect(command, args, options) {
  // Capture stdout/stderr for parsing and error messages while still streaming
  // prefixed output when humans are watching the smoke run.
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
  // Most of the smoke is eventually consistent: containers start, ports bind,
  // subscriptions attach, and the indexer writes after receiving a log.
  const timeoutMs = options.timeoutMs ?? 30_000;
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    assertProcessesRunning(options.processes ?? []);

    try {
      const value = await predicate();

      if (value) {
        console.log(`[local-smoke] ${label} ready`);
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
  // If a supervised child exits while we are waiting for a downstream condition,
  // surface that as the primary failure instead of timing out with stale context.
  for (const processInfo of processes) {
    if (processInfo.code !== null) {
      throw new Error(
        `${processInfo.name} exited before the smoke flow completed (code ${processInfo.code}).`,
      );
    }
  }
}

async function rpcReady() {
  // A raw JSON-RPC call is enough to prove Hardhat is listening without requiring
  // any protocol artifacts yet.
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
}

async function urlOk(url) {
  const response = await fetch(url);
  return response.ok;
}

async function findIndexedMarket(market) {
  const response = await fetch(
    `${apiBaseUrl}/markets?chainId=${market.chainId}`,
  );

  if (!response.ok) {
    return null;
  }

  const markets = await response.json();

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

function parseLabeledJson(stdout, label) {
  // Helper scripts emit one stable LABEL={json} line so this orchestrator can
  // ignore package-manager banners and Hardhat logs around it.
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
  // Prefixing keeps interleaved output from Hardhat, API, and indexer readable
  // when all three are running at once.
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

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

async function shutdown(code) {
  // Reverse shutdown avoids cutting the chain out from under the indexer before
  // it has a chance to unsubscribe and exit cleanly.
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

  // Some watchers ignore SIGTERM while they are inside a dependency. Give them a
  // short grace period, then force-kill so the terminal is not left wedged.
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
