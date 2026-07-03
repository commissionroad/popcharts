#!/usr/bin/env -S node --experimental-strip-types

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

import { DEMO_MARKET_SYMBOL } from "./shared/deployments/demoMarket.ts";
import { readJsonFile } from "./shared/json/readJsonFile.ts";
import { isRpcReady } from "./shared/net/isRpcReady.ts";
import { runInheritedCommand } from "./shared/process/runInheritedCommand.ts";
import { protocolDir } from "./shared/paths.ts";
import { waitFor } from "./shared/wait/waitFor.ts";

/**
 * Runs the chain-backed Playwright e2e suite against a full local deployment:
 * devchain contracts, v4 venue stack, postgrad venue, and one demo
 * complete-set market — proving whole-system deployability, not just the UI.
 * Reuses an already-running devchain when one answers on the RPC port.
 */

const RPC_URL = process.env.POPCHARTS_RPC_URL ?? "http://127.0.0.1:8545";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

type DevchainManifest = {
  contracts: {
    collateral: { address: string };
    pregradManager: { address: string };
  };
};

let hardhatNode: ChildProcess | null = null;
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
      resolve(protocolDir, "node_modules", ".bin", "hardhat"),
      ["node"],
      {
        cwd: protocolDir,
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
    await waitFor("JSON-RPC", () => isRpcReady(RPC_URL), {
      timeoutMs: 30_000,
    });
  }

  await run("pnpm", ["--dir", "protocol", "devchain:deploy"], {
    POPCHARTS_RPC_URL: RPC_URL,
  });

  // Deploy the postgrad venue on top of the devchain contracts so the e2e
  // chain path also proves whole-system deployability: v4 venue stack,
  // postgrad contracts, and one demo complete-set market.
  const devchain = readJsonFile<DevchainManifest>(
    resolve(protocolDir, "deployments", "devchain.local.json"),
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

async function run(
  command: string,
  args: readonly string[],
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<void> {
  await runInheritedCommand(command, args, {
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
}

async function stopHardhatNode(): Promise<void> {
  if (!hardhatNode || hardhatNode.killed) {
    return;
  }

  stoppingHardhatNode = true;
  const child = hardhatNode;
  hardhatNode.kill("SIGTERM");
  hardhatNode = null;

  await new Promise<void>((resolveStop) => {
    const timeout = setTimeout(resolveStop, 3_000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolveStop();
    });
  });
}
