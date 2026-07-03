#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RPC_URL = process.env.POPCHARTS_RPC_URL ?? "http://127.0.0.1:8545";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
// Pinned demo market symbol so the market manifest filename stays predictable
// (protocol/deployments/local.market-pcsm.local.json).
const DEMO_MARKET_SYMBOL = "PCSM";

let hardhatNode = null;
let stoppingHardhatNode = false;

process.on("SIGINT", () => {
  void stopHardhatNode();
  process.exit(130);
});
process.on("SIGTERM", () => {
  void stopHardhatNode();
  process.exit(143);
});

try {
  const existingChain = await isRpcReady(RPC_URL);

  if (existingChain) {
    console.log(`Using existing devchain at ${RPC_URL}`);
  } else {
    console.log(`Starting local Hardhat node at ${RPC_URL}`);
    hardhatNode = spawn(
      resolve("protocol", "node_modules", ".bin", "hardhat"),
      ["node"],
      {
        cwd: "protocol",
        env: process.env,
        stdio: "inherit",
      },
    );
    hardhatNode.on("exit", (code, signal) => {
      if (!stoppingHardhatNode && code !== 0) {
        console.error(
          `Hardhat node exited unexpectedly: ${
            signal ? `signal ${signal}` : `exit code ${code}`
          }`,
        );
      }
    });
    await waitForRpc(RPC_URL, 30_000);
  }

  await run("pnpm", ["--dir", "protocol", "devchain:deploy"], {
    POPCHARTS_RPC_URL: RPC_URL,
  });

  // Deploy the postgrad venue on top of the devchain contracts so the e2e
  // chain path also proves whole-system deployability: v4 venue stack,
  // postgrad contracts, and one demo complete-set market.
  const devchain = JSON.parse(
    readFileSync(
      resolve("protocol", "deployments", "devchain.local.json"),
      "utf8",
    ),
  );
  await run("pnpm", ["--dir", "protocol", "local:deploy-venue"], {
    POPCHARTS_RPC_URL: RPC_URL,
  });
  await run("pnpm", ["--dir", "protocol", "local:deploy-postgrad"], {
    POPCHARTS_PREGRAD_MANAGER_ADDRESS:
      devchain.contracts.pregradManager.address,
    POPCHARTS_RPC_URL: RPC_URL,
  });
  await run("pnpm", ["--dir", "protocol", "local:create-complete-set-market"], {
    POPCHARTS_COLLATERAL_ADDRESS: devchain.contracts.collateral.address,
    POPCHARTS_MARKET_SYMBOL: DEMO_MARKET_SYMBOL,
    POPCHARTS_RPC_URL: RPC_URL,
  });

  await run("pnpm", ["--dir", "app", "test:e2e:chain"], {
    PLAYWRIGHT_BASE_URL: BASE_URL,
    POPCHARTS_E2E_CHAIN: "true",
  });
} finally {
  await stopHardhatNode();
}

async function run(command, args, extraEnv = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with ${
            signal ? `signal ${signal}` : `exit code ${code}`
          }`,
        ),
      );
    });
  });
}

async function waitForRpc(rpcUrl, timeoutMs) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (await isRpcReady(rpcUrl)) {
      return;
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for JSON-RPC at ${rpcUrl}`);
}

async function isRpcReady(rpcUrl) {
  try {
    const response = await fetch(rpcUrl, {
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
    const result = await response.json();

    return Boolean(result.result);
  } catch {
    return false;
  }
}

async function stopHardhatNode() {
  if (!hardhatNode || hardhatNode.killed) {
    return;
  }

  stoppingHardhatNode = true;
  const child = hardhatNode;
  hardhatNode.kill("SIGTERM");
  hardhatNode = null;

  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3_000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
