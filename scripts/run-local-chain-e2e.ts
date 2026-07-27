#!/usr/bin/env -S node --experimental-strip-types

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEMO_MARKET_SYMBOL } from "./shared/deployments/demoMarket.ts";
import { readJsonFile } from "./shared/json/readJsonFile.ts";
import { deriveStackResources } from "./shared/localStack/ports.ts";
import {
  resolveProtocolChainEnv,
  type ProtocolChainEnv,
} from "./shared/localStack/protocolChainEnv.ts";
import { readSlotFromEnv } from "./shared/localStack/readSlotFromEnv.ts";
import { isRpcReady } from "./shared/net/isRpcReady.ts";
import { parseRpcListenTarget } from "./shared/net/parseRpcListenTarget.ts";
import { runInheritedCommand } from "./shared/process/runInheritedCommand.ts";
import { protocolDir } from "./shared/paths.ts";
import { waitFor } from "./shared/wait/waitFor.ts";

/**
 * Runs the chain-backed Playwright e2e suite against a full local deployment:
 * devchain contracts, v4 venue stack, postgrad venue, and one demo
 * complete-set market — proving whole-system deployability, not just the UI.
 * Reuses an already-running devchain when one answers on the RPC port.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

type DevchainManifest = {
  contracts: {
    collateral: { address: string };
    pregradManager: { address: string };
  };
};

/** The single chain a devchain e2e run probes, starts, and deploys against. */
export type LocalChainE2eTarget = {
  readonly chainEnv: ProtocolChainEnv;
  readonly hardhatNodeArgs: readonly string[];
};

let hardhatNode: ChildProcess | null = null;
let stoppingHardhatNode = false;

/**
 * Resolves the one chain this run uses for everything: the readiness probe, the
 * `hardhat node` it may start, and every protocol helper it spawns.
 *
 * Three of the four helpers are `hardhat run --network localhost`, whose
 * transport comes from POPCHARTS_LOCAL_RPC_URL — not the POPCHARTS_RPC_URL
 * those scripts merely copy into the manifests they emit. Deriving both ends
 * from one URL is what stops a manifest from naming this run's chain while the
 * deploy transactions land on slot 0's (ADR 0020 Phase 4 correction).
 *
 * An explicit POPCHARTS_STACK_SLOT wins outright because a slot owns its chain
 * port; otherwise an inherited RPC_HTTP_URL/POPCHARTS_LOCAL_RPC_URL leads and
 * slot 0 is the last resort. POPCHARTS_RPC_URL is deliberately not consulted:
 * it also names the arc testnet (`protocol/hardhat.config.ts`), so a shell
 * carrying `.env.example`'s value would otherwise redirect a local run.
 */
export function resolveLocalChainE2eTarget(
  env: NodeJS.ProcessEnv,
): LocalChainE2eTarget {
  const slotIsExplicit =
    env.POPCHARTS_STACK_SLOT !== undefined && env.POPCHARTS_STACK_SLOT !== "";
  const chainEnv = resolveProtocolChainEnv(
    env,
    slotIsExplicit ? deriveStackResources(readSlotFromEnv(env)) : undefined,
  );
  const { hostname, port } = parseRpcListenTarget(chainEnv.RPC_HTTP_URL);

  return {
    chainEnv,
    // Without these the node binds hardhat's 127.0.0.1:8545 default, so any
    // non-zero slot probed and deployed against a chain nothing ever started.
    hardhatNodeArgs: ["node", "--hostname", hostname, "--port", port],
  };
}

/**
 * The exact environment a protocol helper is spawned with. The chain variables
 * are applied last so nothing inherited from the caller's shell can shadow the
 * chain this run resolved: a resolved chain that never reaches the child is the
 * failure this guards, not a mis-resolved one.
 */
export function buildProtocolCommandEnv({
  baseEnv,
  chainEnv,
  deploymentEnv = {},
}: {
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly chainEnv: ProtocolChainEnv;
  readonly deploymentEnv?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    ...deploymentEnv,
    ...chainEnv,
  };
}

async function main(): Promise<void> {
  const { chainEnv, hardhatNodeArgs } = resolveLocalChainE2eTarget(process.env);
  const rpcUrl = chainEnv.RPC_HTTP_URL;

  process.on("SIGINT", () => {
    void stopHardhatNode();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    void stopHardhatNode();
    process.exit(143);
  });

  try {
    const existingChain = await isRpcReady(rpcUrl);

    if (existingChain) {
      console.log(`Using existing devchain at ${rpcUrl}`);
    } else {
      console.log(`Starting local Hardhat node at ${rpcUrl}`);
      hardhatNode = spawn(
        resolve(protocolDir, "node_modules", ".bin", "hardhat"),
        [...hardhatNodeArgs],
        {
          cwd: protocolDir,
          env: buildProtocolCommandEnv({ baseEnv: process.env, chainEnv }),
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
      await waitFor("JSON-RPC", () => isRpcReady(rpcUrl), {
        timeoutMs: 30_000,
      });
    }

    await run("pnpm", ["--dir", "protocol", "devchain:deploy"], chainEnv);

    // Deploy the postgrad venue on top of the devchain contracts so the e2e
    // chain path also proves whole-system deployability: v4 venue stack,
    // postgrad contracts, and one demo complete-set market.
    const devchain = readJsonFile<DevchainManifest>(
      resolve(protocolDir, "deployments", "devchain.local.json"),
    );
    await run("pnpm", ["--dir", "protocol", "local:deploy-venue"], chainEnv);
    await run(
      "pnpm",
      ["--dir", "protocol", "local:deploy-postgrad"],
      chainEnv,
      {
        POPCHARTS_PREGRAD_MANAGER_ADDRESS:
          devchain.contracts.pregradManager.address,
      },
    );
    await run(
      "pnpm",
      ["--dir", "protocol", "local:create-complete-set-market"],
      chainEnv,
      {
        POPCHARTS_COLLATERAL_ADDRESS: devchain.contracts.collateral.address,
        POPCHARTS_MARKET_SYMBOL: DEMO_MARKET_SYMBOL,
      },
    );

    await run("pnpm", ["--dir", "app", "test:e2e:chain"], chainEnv, {
      PLAYWRIGHT_BASE_URL: BASE_URL,
      POPCHARTS_E2E_CHAIN: "true",
    });
  } finally {
    await stopHardhatNode();
  }
}

async function run(
  command: string,
  args: readonly string[],
  chainEnv: ProtocolChainEnv,
  deploymentEnv: NodeJS.ProcessEnv = {},
): Promise<void> {
  await runInheritedCommand(command, args, {
    env: buildProtocolCommandEnv({
      baseEnv: process.env,
      chainEnv,
      deploymentEnv,
    }),
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

// Guarded so the exported seams above can be imported by scripts/test without
// starting a chain.
if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
