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

let smoke: ChildProcess | null = null;
let smokeStdout = "";
let stoppingSmoke = false;

process.on("SIGINT", () => {
  void stopSmoke();
  process.exit(130);
});
process.on("SIGTERM", () => {
  void stopSmoke();
  process.exit(143);
});

try {
  console.log("Starting the local lifecycle stack (local:smoke)...");
  smoke = spawn("pnpm", ["local:smoke", "--", "--keep-running", "--fresh-db"], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"],
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

async function stopSmoke(): Promise<void> {
  if (!smoke || smoke.killed) {
    return;
  }

  stoppingSmoke = true;
  const child = smoke;
  smoke.kill("SIGTERM");
  smoke = null;

  await new Promise<void>((resolveStop) => {
    const timeout = setTimeout(resolveStop, 5_000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolveStop();
    });
  });
}
