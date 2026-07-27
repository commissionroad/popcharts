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

/** How a child is executed, injected so tests can observe the handoff. */
export type CommandExecutor = (
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv },
) => Promise<void>;

/** How the chain node is spawned, injected for the same reason. */
export type ProcessSpawner = (
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly stdio: "inherit";
  },
) => ChildProcess;

// Hosts that name a chain on this machine. A POPCHARTS_RPC_URL pointing at one
// of these was meant to select a local chain; anything else is a remote network.
const LOOPBACK_HOSTNAMES = new Set([
  "0.0.0.0",
  "127.0.0.1",
  "::1",
  "localhost",
]);

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

  assertNoStrandedRpcOverride(env, chainEnv.RPC_HTTP_URL);

  return {
    chainEnv,
    // Without these the node binds hardhat's 127.0.0.1:8545 default, so any
    // non-zero slot probed and deployed against a chain nothing ever started.
    hardhatNodeArgs: ["node", "--hostname", hostname, "--port", port],
  };
}

/**
 * Rejects a POPCHARTS_RPC_URL that names a local chain this run will not use
 * and that nothing else corroborates.
 *
 * Before the chain pin was fixed, that variable did steer the probe and
 * `devchain:deploy` (though never the three `--network localhost` deploys), so
 * dropping it as an input is an observable change. Failing loudly beats
 * silently relocating such a run to slot 0.
 *
 * A remote value is ignored rather than rejected: that is `.env.example`'s arc
 * testnet URL riding in a developer's shell, and a chain-backed local e2e was
 * never going to run against it. A value matching the resolved chain, or one
 * corroborated by RPC_HTTP_URL/POPCHARTS_LOCAL_RPC_URL, is likewise fine —
 * `with-target-stack` exports all three together.
 */
function assertNoStrandedRpcOverride(
  env: NodeJS.ProcessEnv,
  resolvedRpcUrl: string,
): void {
  const override = env.POPCHARTS_RPC_URL;

  if (
    override === undefined ||
    override === "" ||
    override === resolvedRpcUrl ||
    env.RPC_HTTP_URL !== undefined ||
    env.POPCHARTS_LOCAL_RPC_URL !== undefined
  ) {
    return;
  }

  let hostname: string;

  try {
    ({ hostname } = parseRpcListenTarget(override));
  } catch {
    return;
  }

  if (!LOOPBACK_HOSTNAMES.has(hostname)) {
    return;
  }

  throw new Error(
    `POPCHARTS_RPC_URL=${override} names a local chain, but this run targets ` +
      `${resolvedRpcUrl}. The devchain e2e does not read POPCHARTS_RPC_URL to ` +
      "choose a chain: protocol/hardhat.config.ts also reads it for the arc " +
      "testnet network, and the '--network localhost' deploys take their " +
      "transport from POPCHARTS_LOCAL_RPC_URL. Set POPCHARTS_LOCAL_RPC_URL, " +
      "RPC_HTTP_URL, or POPCHARTS_STACK_SLOT to pick the chain, or unset " +
      "POPCHARTS_RPC_URL to use the default.",
  );
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
      hardhatNode = startHardhatNode({ chainEnv, hardhatNodeArgs });
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

    await runProtocolCommand({
      args: ["--dir", "protocol", "devchain:deploy"],
      chainEnv,
      command: "pnpm",
    });

    // Deploy the postgrad venue on top of the devchain contracts so the e2e
    // chain path also proves whole-system deployability: v4 venue stack,
    // postgrad contracts, and one demo complete-set market.
    const devchain = readJsonFile<DevchainManifest>(
      resolve(protocolDir, "deployments", "devchain.local.json"),
    );
    await runProtocolCommand({
      args: ["--dir", "protocol", "local:deploy-venue"],
      chainEnv,
      command: "pnpm",
    });
    await runProtocolCommand({
      args: ["--dir", "protocol", "local:deploy-postgrad"],
      chainEnv,
      command: "pnpm",
      deploymentEnv: {
        POPCHARTS_PREGRAD_MANAGER_ADDRESS:
          devchain.contracts.pregradManager.address,
      },
    });
    await runProtocolCommand({
      args: ["--dir", "protocol", "local:create-complete-set-market"],
      chainEnv,
      command: "pnpm",
      deploymentEnv: {
        POPCHARTS_COLLATERAL_ADDRESS: devchain.contracts.collateral.address,
        POPCHARTS_MARKET_SYMBOL: DEMO_MARKET_SYMBOL,
      },
    });

    await runProtocolCommand({
      args: ["--dir", "app", "test:e2e:chain"],
      chainEnv,
      command: "pnpm",
      deploymentEnv: {
        PLAYWRIGHT_BASE_URL: BASE_URL,
        POPCHARTS_E2E_CHAIN: "true",
      },
    });
  } finally {
    await stopHardhatNode();
  }
}

/**
 * Runs one protocol helper against the resolved chain.
 *
 * `execute` is injectable because the original defect was not a mis-resolved
 * chain but a correctly-resolved one that never reached the child: a test that
 * only checks the resolver, or only the env builder, stays green through the
 * exact regression. Tests assert the environment handed to `execute` here,
 * which is the boundary that leaked.
 */
export async function runProtocolCommand({
  args,
  baseEnv = process.env,
  chainEnv,
  command,
  deploymentEnv = {},
  execute = runInheritedCommand,
}: {
  readonly args: readonly string[];
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly chainEnv: ProtocolChainEnv;
  readonly command: string;
  readonly deploymentEnv?: NodeJS.ProcessEnv;
  readonly execute?: CommandExecutor;
}): Promise<void> {
  await execute(command, args, {
    env: buildProtocolCommandEnv({ baseEnv, chainEnv, deploymentEnv }),
  });
}

/**
 * Starts the chain node this run will use, bound to the resolved chain's host
 * and port. Spawned through an injectable `spawnProcess` for the same reason
 * `runProtocolCommand` takes an executor: dropping the argv or the environment
 * here is the half of the defect that a resolver test cannot see.
 */
export function startHardhatNode({
  baseEnv = process.env,
  chainEnv,
  hardhatNodeArgs,
  spawnProcess = spawn,
}: {
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly chainEnv: ProtocolChainEnv;
  readonly hardhatNodeArgs: readonly string[];
  readonly spawnProcess?: ProcessSpawner;
}): ChildProcess {
  return spawnProcess(
    resolve(protocolDir, "node_modules", ".bin", "hardhat"),
    [...hardhatNodeArgs],
    {
      cwd: protocolDir,
      env: buildProtocolCommandEnv({ baseEnv, chainEnv }),
      stdio: "inherit",
    },
  );
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
