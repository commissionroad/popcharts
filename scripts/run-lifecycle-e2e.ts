#!/usr/bin/env -S node --experimental-strip-types

import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";

import { DEMO_MARKET_SYMBOL } from "./shared/deployments/demoMarket.ts";
import type { PregradDeploy } from "./shared/deployments/pregradDeploy.ts";
import { readPostgradDeployment } from "./shared/deployments/readPostgradDeployment.ts";
import { buildLocalAppEnv } from "./shared/env/buildLocalAppEnv.ts";
import { appLocalDevEnvFile } from "./shared/env/localDevEnvFiles.ts";
import { writeEnvMarkerBlock } from "./shared/env/writeEnvMarkerBlock.ts";
import { SMOKE_READINESS_LINE } from "./shared/localStack/smokeReadinessLine.ts";
import { repoRoot } from "./shared/paths.ts";
import { runInheritedCommand } from "./shared/process/runInheritedCommand.ts";
import { signalProcessGroup } from "./shared/process/signalProcessGroup.ts";
import { waitFor } from "./shared/wait/waitFor.ts";

/**
 * Runs the full-stack lifecycle Playwright suite (ADR 0018 slice 6): boots
 * the chain + Postgres + API + indexer via `local:smoke --keep-running`,
 * writes the app's generated env for that stack, and drives the
 * `@lifecycle`-tagged specs, which walk markets through graduation into the
 * resolved / draw-cancelled terminal states and redeem through the UI.
 *
 * Unlike run-local-chain-e2e.ts (chain + app only, devchain-relay mode),
 * these specs need indexed market state served by the real API — terminal
 * surfaces render from `markets.status` + `resolution`, which only the
 * indexer produces.
 */

const SMOKE_STARTUP_TIMEOUT_MS = 10 * 60_000;
/**
 * How long the smoke gets to run its own supervised shutdown after SIGTERM
 * before the group is killed outright. It stops three services in sequence,
 * each with its own SIGTERM→SIGKILL grace, so the window has to outlast that.
 */
const SMOKE_SHUTDOWN_GRACE_MS = 15_000;
/** How long to wait for the exit that the escalated SIGKILL should produce. */
const SMOKE_KILL_TIMEOUT_MS = 10_000;

let smoke: ChildProcess | null = null;
let smokeClosed = false;
let smokeStdout = "";
let stoppingSmoke = false;

// The handlers below exit without awaiting the async teardown, and a throw
// routed past the `finally` skips it entirely; this backstop group-kills the
// stack synchronously on the way out so it can never outlive this script.
process.on("exit", () => {
  if (!smokeClosed) {
    signalProcessGroup(smoke?.pid, "SIGKILL");
  }
});
// Detaching the smoke takes it out of this script's process group, so a
// terminal Ctrl-C no longer reaches it on its own — these handlers are now the
// only path to a graceful stack shutdown. stopSmoke() is bounded, so awaiting
// it here cannot wedge the exit.
process.on("SIGINT", () => {
  void stopSmokeAndExit(130);
});
process.on("SIGTERM", () => {
  void stopSmokeAndExit(143);
});

try {
  console.log("Starting the local lifecycle stack (local:smoke)...");
  smoke = spawn("pnpm", ["local:smoke", "--", "--keep-running", "--fresh-db"], {
    cwd: repoRoot,
    // Detached makes the smoke its own process-group leader so teardown can
    // signal the whole stack. Without it the `pnpm` wrapper is not a group
    // leader, a negative-PID signal fails with ESRCH, and the services it
    // started survive — holding this script's stdout pipe open. See stopSmoke.
    detached: true,
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"],
  });
  // `close` (this script's stdio pipes are closed), not `exit` (the wrapper
  // process ended): the orchestrator `pnpm` spawns inherits the pipe and can
  // outlive its parent, and a pipe someone still holds is precisely what stops
  // a CI step from finishing. `exit` would report teardown done too early.
  smoke.once("close", () => {
    smokeClosed = true;
  });
  smoke.stdout?.setEncoding("utf8");
  smoke.stdout?.on("data", (chunk: string) => {
    smokeStdout += chunk;
    process.stdout.write(chunk);
  });

  const smokeExitedEarly = new Promise<never>((_, reject) => {
    smoke?.once("exit", (code, signal) => {
      if (!stoppingSmoke) {
        reject(
          new Error(
            `local:smoke exited before readiness (${
              signal ? `signal ${signal}` : `code ${code}`
            })`,
          ),
        );
      }
    });
  });

  await Promise.race([
    waitFor("lifecycle stack readiness", () =>
      smokeStdout.includes(SMOKE_READINESS_LINE),
    {
      timeoutMs: SMOKE_STARTUP_TIMEOUT_MS,
    }),
    smokeExitedEarly,
  ]);

  // The smoke's own console lines cross the process boundary but its
  // children's stdout does not, so the deploy record is read from the
  // generated env file the smoke writes rather than parsed from stdout.
  const generatedEnv = readGeneratedEnv(smokeStdout);
  const rpcHttpUrl = requireEnvValue(generatedEnv, "RPC_HTTP_URL");
  const deploy: PregradDeploy = {
    chainId: await readChainId(rpcHttpUrl),
    collateralAddress: requireEnvValue(generatedEnv, "LOCAL_COLLATERAL_ADDRESS"),
    deployBlock: requireEnvValue(generatedEnv, "PREGRAD_MANAGER_DEPLOY_BLOCK"),
    postgradAdapterAddress: requireEnvValue(
      generatedEnv,
      "LOCAL_POSTGRAD_ADAPTER_ADDRESS",
    ),
    pregradManagerAddress: requireEnvValue(
      generatedEnv,
      "PREGRAD_MANAGER_ADDRESS",
    ),
  };
  const apiBaseUrl = parseApiBaseUrl(smokeStdout);
  const postgrad = readPostgradDeployment(DEMO_MARKET_SYMBOL);

  // The Playwright webServer boots `next dev`, which reads this generated
  // block — the same one the local-dev orchestrators write — so the app
  // points at the smoke stack's chain and API.
  writeEnvMarkerBlock({
    env: buildLocalAppEnv({ apiBaseUrl, deploy, postgrad, rpcHttpUrl }),
    filePath: appLocalDevEnvFile,
  });
  console.log(`\nApp env written for API ${apiBaseUrl} / RPC ${rpcHttpUrl}`);

  await runInheritedCommand("pnpm", ["--dir", "app", "test:e2e:lifecycle"], {
    env: {
      ...process.env,
      POPCHARTS_E2E_API_BASE_URL: apiBaseUrl,
      POPCHARTS_E2E_CHAIN_ID: String(deploy.chainId),
      POPCHARTS_E2E_COLLATERAL_ADDRESS: deploy.collateralAddress,
      POPCHARTS_E2E_LIFECYCLE: "true",
      POPCHARTS_E2E_PREGRAD_MANAGER_ADDRESS: deploy.pregradManagerAddress,
      POPCHARTS_E2E_RPC_URL: rpcHttpUrl,
    },
  });
} finally {
  await stopSmoke();
}

/** The smoke prints `- API: <base>/markets?chainId=N` at readiness. */
function parseApiBaseUrl(stdout: string): string {
  const match = stdout.match(/^- API: (http:\/\/[^/\s]+)\//m);
  if (!match) {
    throw new Error("Could not find the API base URL in local:smoke output.");
  }

  return match[1]!;
}

/**
 * The smoke prints `- Env file: <path>` at readiness; the generated file
 * carries the stack's RPC endpoint and deployed addresses (slot-dependent
 * under ADR 0020, so none of them can be hardcoded here).
 */
function readGeneratedEnv(stdout: string): Map<string, string> {
  const fileMatch = stdout.match(/^- Env file: (.+)$/m);
  if (!fileMatch) {
    throw new Error("Could not find the env file path in local:smoke output.");
  }
  const entries = new Map<string, string>();
  for (const line of readFileSync(fileMatch[1]!.trim(), "utf8").split("\n")) {
    const separator = line.indexOf("=");
    if (separator > 0 && !line.startsWith("#")) {
      entries.set(line.slice(0, separator), line.slice(separator + 1).trim());
    }
  }

  return entries;
}

function requireEnvValue(env: Map<string, string>, key: string): string {
  const value = env.get(key);
  if (!value) {
    throw new Error(`Generated env file is missing ${key}.`);
  }

  return value;
}

async function readChainId(rpcHttpUrl: string): Promise<number> {
  const response = await fetch(rpcHttpUrl, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "eth_chainId",
      params: [],
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = (await response.json()) as { result?: string };
  if (!body.result) {
    throw new Error(`eth_chainId returned no result from ${rpcHttpUrl}`);
  }

  return Number.parseInt(body.result, 16);
}

/**
 * Stops the smoke stack, resolving only once it has really exited.
 *
 * Signals go to the process GROUP: the child is a `pnpm` wrapper around the
 * orchestrator that owns the chain, API and indexer, and those services inherit
 * this script's stdout pipe. SIGTERM first, so the orchestrator can run its own
 * supervised shutdown, then SIGKILL if it wedges.
 *
 * The old version signalled the wrapper PID alone and gave up after a fixed 5s
 * whether or not anything had died. Survivors kept the pipe open, and in CI a
 * step cannot finish while a process holds its output: a green suite left the
 * nightly job running for 37 more minutes until the 40-minute cap cancelled it.
 *
 * Completion is judged by `close`, not `exit`. The wrapper exiting proves only
 * that `pnpm` is gone; the orchestrator beneath it holds this script's pipe and
 * runs the shutdown that stops the services (which sit in their own groups, out
 * of reach of the signal sent here). `close` fires when nothing holds the pipe
 * any more, which is the property CI actually needs. `child.killed` is no use
 * either way — it only records that `kill()` was called, and a group signal
 * leaves it false.
 */
async function stopSmoke(): Promise<void> {
  if (!smoke || smokeClosed) {
    return;
  }

  stoppingSmoke = true;
  const child = smoke;
  // Signalling the stack makes `pnpm` report its child as failed
  // (`ELIFECYCLE ... 143`). That line is expected teardown noise, not a suite
  // failure — say so here, because reading it as one costs real triage time.
  console.log("Stopping the lifecycle stack (expect an ELIFECYCLE 143 below)…");
  const closed = new Promise<void>((resolveStop) => {
    child.once("close", () => resolveStop());
  });

  reportSignalFailure(signalProcessGroup(child.pid, "SIGTERM"));
  const escalation = setTimeout(() => {
    reportSignalFailure(signalProcessGroup(child.pid, "SIGKILL"));
    // Belt and braces: a group signal only lands if the child really is a
    // group leader, and ESRCH cannot be told apart from "already gone". This
    // reaches the wrapper itself either way.
    child.kill("SIGKILL");
  }, SMOKE_SHUTDOWN_GRACE_MS);

  // SIGKILL cannot be caught, so the exit is expected — but this must never
  // trade the old bug for a worse one by waiting forever if it never comes.
  // Both timers are cleared below: a *pending* timer keeps Node's event loop
  // alive, which is the same "script will not exit" failure being fixed here.
  let abandonment: NodeJS.Timeout | undefined;
  const abandoned = new Promise<boolean>((resolveAbandoned) => {
    abandonment = setTimeout(
      () => resolveAbandoned(true),
      SMOKE_SHUTDOWN_GRACE_MS + SMOKE_KILL_TIMEOUT_MS,
    );
  });

  try {
    if (await Promise.race([closed.then(() => false), abandoned])) {
      console.error(
        `The lifecycle stack (pid ${child.pid}) still holds this script's output after SIGKILL; giving up and leaving it running.`,
      );
    }
  } finally {
    clearTimeout(escalation);
    clearTimeout(abandonment);
  }
}

async function stopSmokeAndExit(code: number): Promise<never> {
  await stopSmoke();
  process.exit(code);
}

function reportSignalFailure(failure: NodeJS.ErrnoException | null): void {
  if (failure) {
    console.error(`Failed to signal the lifecycle stack: ${failure.message}`);
  }
}
