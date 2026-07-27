#!/usr/bin/env -S node --experimental-strip-types

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEMO_MARKET_SYMBOL } from "./shared/deployments/demoMarket.ts";
import { readJsonFile } from "./shared/json/readJsonFile.ts";
import {
  BASE_APP_PORT,
  deriveStackResources,
  slotForAppPort,
  slotForChainPort,
} from "./shared/localStack/ports.ts";
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

type DevchainManifest = {
  contracts: {
    collateral: { address: string };
    pregradManager: { address: string };
  };
};

/**
 * The single stack a devchain e2e run drives: the chain it probes, starts, and
 * deploys against, and the app server the browser suite drives — both derived
 * from one slot so they cannot name different stacks.
 */
export type LocalChainE2eTarget = {
  readonly appBaseUrl: string;
  readonly appPort: string;
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
 *
 * The app server is resolved here too, from the slot that owns the resolved
 * chain, so the browser half of the run lands on the same stack as the chain
 * half (see `resolveAppServer`).
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
    ...resolveAppServer(env, port),
    chainEnv,
    // Without these the node binds hardhat's 127.0.0.1:8545 default, so any
    // non-zero slot probed and deployed against a chain nothing ever started.
    hardhatNodeArgs: ["node", "--hostname", hostname, "--port", port],
  };
}

/**
 * Picks the app server the Playwright suite drives, from the slot that owns
 * the chain this run already resolved.
 *
 * `app/playwright.config.ts` defaults PLAYWRIGHT_APP_PORT to 3000 and boots
 * `next dev` there, with `reuseExistingServer` on locally. Left underived, a
 * run on a non-zero slot started its chain on that slot's port and then quietly
 * adopted slot 0's already-running app — one wired to slot 0's chain — so the
 * suite asserted against the wrong stack while reporting success (ADR 0020).
 *
 * A caller's own PLAYWRIGHT_BASE_URL still wins, since it names an app server
 * that exists; its port leads too, so the config cannot boot `next dev` on one
 * port while the suite drives another. It may not name a *different slot's*
 * app, though — see `assertAppOverrideOnThisStack`. A chain on a port no slot
 * owns has no slot-derived app port to offer, so it keeps the historical 3000,
 * with PLAYWRIGHT_APP_PORT as the way to say otherwise.
 */
function resolveAppServer(
  env: NodeJS.ProcessEnv,
  chainPort: string,
): { appBaseUrl: string; appPort: string } {
  const chainSlot = slotForChainPort(Number(chainPort));
  const baseUrlOverride = env.PLAYWRIGHT_BASE_URL;

  if (baseUrlOverride !== undefined && baseUrlOverride !== "") {
    const appPort = parseRpcListenTarget(baseUrlOverride).port;
    assertAppOverrideOnThisStack({
      appPort,
      chainSlot,
      override: `PLAYWRIGHT_BASE_URL=${baseUrlOverride}`,
    });

    return { appBaseUrl: baseUrlOverride, appPort };
  }

  const portOverride = env.PLAYWRIGHT_APP_PORT;

  if (portOverride !== undefined && portOverride !== "") {
    assertAppOverrideOnThisStack({
      appPort: portOverride,
      chainSlot,
      override: `PLAYWRIGHT_APP_PORT=${portOverride}`,
    });

    return {
      appBaseUrl: `http://localhost:${portOverride}`,
      appPort: portOverride,
    };
  }

  const appPort = String(
    chainSlot === undefined
      ? BASE_APP_PORT
      : deriveStackResources(chainSlot).appPort,
  );

  return { appBaseUrl: `http://localhost:${appPort}`, appPort };
}

/**
 * Rejects an app-server override that names another slot's app.
 *
 * An override exists so a run can drive an app this script did not start — a
 * built `next start`, a tunnel, a nonstandard port. What it must not do is
 * hand the run a *different stack's* app: `reuseExistingServer` would adopt
 * that slot's `next dev`, which talks to that slot's chain, and the suite
 * would pass against the stack this whole fix exists to keep it off. An
 * operator typing the port makes that no less silent than the old hardcoded
 * 3000 did.
 *
 * Only a port some slot owns is refused, which is what makes this narrow: a
 * port outside the slot grid belongs to nobody, so it is the operator's own
 * server and is allowed. A chain outside the grid gives nothing to compare
 * against, so it is allowed too. Same shape as
 * `assertNoStrandedRpcOverride`: an explicit value that would silently
 * relocate half the run is an error, not an instruction.
 */
function assertAppOverrideOnThisStack({
  appPort,
  chainSlot,
  override,
}: {
  readonly appPort: string;
  readonly chainSlot: number | undefined;
  readonly override: string;
}): void {
  const overrideSlot = slotForAppPort(Number(appPort));

  if (
    chainSlot === undefined ||
    overrideSlot === undefined ||
    overrideSlot === chainSlot
  ) {
    return;
  }

  const chain = deriveStackResources(chainSlot);

  throw new Error(
    `${override} is slot ${overrideSlot}'s app, but this run's chain is ` +
      `slot ${chainSlot}'s (${chain.chainRpcHttpUrl}). Playwright would ` +
      "reuse that slot's already-running app, which talks to its own chain, " +
      "and the suite would pass against the wrong stack. Point it at slot " +
      `${chainSlot}'s app (port ${chain.appPort}), unset it to derive that ` +
      "port, or use a port no slot owns for an app you started yourself.",
  );
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

/**
 * The variables that aim the Playwright run at this run's app server.
 *
 * Exported for the same reason the chain env builder is: resolving the app
 * server correctly is worthless if the value never reaches the child, and the
 * config reads the port and the URL from two separate variables, so a partial
 * handoff silently reverts half of this to slot 0.
 */
export function buildAppSuiteEnv({
  appBaseUrl,
  appPort,
}: Pick<LocalChainE2eTarget, "appBaseUrl" | "appPort">): NodeJS.ProcessEnv {
  return {
    PLAYWRIGHT_APP_PORT: appPort,
    PLAYWRIGHT_BASE_URL: appBaseUrl,
    POPCHARTS_E2E_CHAIN: "true",
  };
}

/**
 * Everything a run does after its stack is resolved: probe the chain, start
 * one if nothing answers, deploy the four protocol artifacts, then drive the
 * browser suite — each child pinned to the resolved stack.
 *
 * Every effect is injected, because the two defects this file has already had
 * both lived *here*, at the call sites, and neither was reachable from a test
 * of the pure helpers. `buildProtocolCommandEnv` and `buildAppSuiteEnv` can
 * each be perfect while this function passes a hardcoded value instead — that
 * is exactly the old `PLAYWRIGHT_BASE_URL = "http://localhost:3000"`, and a
 * suite that only exercises the builders stays green through the regression.
 * With the seams here, reverting any of that wiring fails the suite.
 *
 * `main` keeps only the signal handlers, which own no stack state.
 */
export async function runLocalChainE2e({
  env = process.env,
  execute = runInheritedCommand,
  log = console.log,
  probeRpc = isRpcReady,
  readManifest = readJsonFile<DevchainManifest>,
  spawnProcess = spawn,
}: {
  readonly env?: NodeJS.ProcessEnv;
  readonly execute?: CommandExecutor;
  readonly log?: (message: string) => void;
  readonly probeRpc?: (rpcUrl: string) => Promise<boolean>;
  readonly readManifest?: (path: string) => DevchainManifest;
  readonly spawnProcess?: ProcessSpawner;
} = {}): Promise<void> {
  const { appBaseUrl, appPort, chainEnv, hardhatNodeArgs } =
    resolveLocalChainE2eTarget(env);
  const rpcUrl = chainEnv.RPC_HTTP_URL;
  // The run's own environment is what every child inherits from, so a test
  // driving a fake env gets a hermetic run rather than the ambient shell.
  const runCommand = (options: {
    readonly args: readonly string[];
    readonly deploymentEnv?: NodeJS.ProcessEnv;
  }): Promise<void> =>
    runProtocolCommand({
      args: options.args,
      baseEnv: env,
      chainEnv,
      command: "pnpm",
      deploymentEnv: options.deploymentEnv,
      execute,
    });

  try {
    if (await probeRpc(rpcUrl)) {
      log(`Using existing devchain at ${rpcUrl}`);
    } else {
      log(`Starting local Hardhat node at ${rpcUrl}`);
      hardhatNode = startHardhatNode({
        baseEnv: env,
        chainEnv,
        hardhatNodeArgs,
        spawnProcess,
      });
      hardhatNode.on("exit", (code, signal) => {
        if (!stoppingHardhatNode && code !== 0) {
          console.error(
            `Hardhat node exited unexpectedly: ${
              signal ? `signal ${signal}` : `exit code ${code}`
            }`,
          );
        }
      });
      await waitFor("JSON-RPC", () => probeRpc(rpcUrl), {
        timeoutMs: 30_000,
      });
    }

    await runCommand({ args: ["--dir", "protocol", "devchain:deploy"] });

    // Deploy the postgrad venue on top of the devchain contracts so the e2e
    // chain path also proves whole-system deployability: v4 venue stack,
    // postgrad contracts, and one demo complete-set market.
    const devchain = readManifest(
      resolve(protocolDir, "deployments", "devchain.local.json"),
    );
    await runCommand({ args: ["--dir", "protocol", "local:deploy-venue"] });
    await runCommand({
      args: ["--dir", "protocol", "local:deploy-postgrad"],
      deploymentEnv: {
        POPCHARTS_PREGRAD_MANAGER_ADDRESS:
          devchain.contracts.pregradManager.address,
      },
    });
    await runCommand({
      args: ["--dir", "protocol", "local:create-complete-set-market"],
      deploymentEnv: {
        POPCHARTS_COLLATERAL_ADDRESS: devchain.contracts.collateral.address,
        POPCHARTS_MARKET_SYMBOL: DEMO_MARKET_SYMBOL,
      },
    });

    log(`Running the devchain e2e suite against ${appBaseUrl}`);
    await runCommand({
      args: ["--dir", "app", "test:e2e:chain"],
      deploymentEnv: buildAppSuiteEnv({ appBaseUrl, appPort }),
    });
  } finally {
    await stopHardhatNode();
  }
}

async function main(): Promise<void> {
  process.on("SIGINT", () => {
    void stopHardhatNode();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    void stopHardhatNode();
    process.exit(143);
  });

  await runLocalChainE2e();
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
