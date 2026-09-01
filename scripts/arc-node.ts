import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ARC_LOCALDEV_CHAIN,
  ARC_LOCALDEV_CHAIN_ID,
  ARC_NODE_VERSION,
} from "./shared/chain/arcNodeRelease.ts";
import { arcChainLogDir } from "./shared/chain/arcNodePaths.ts";
import { ensureArcNode } from "./shared/chain/ensureArcNode.ts";
import { assertValidSlot } from "./shared/localStack/assertValidSlot.ts";
import {
  deriveStackResources,
  slotForChainPort,
  type StackPorts,
} from "./shared/localStack/ports.ts";
import { readSlotFromEnv } from "./shared/localStack/readSlotFromEnv.ts";

/**
 * Fetches and runs the pinned Arc node as a local devchain.
 *
 * Usage:
 *   node --experimental-strip-types scripts/arc-node.ts fetch
 *   node --experimental-strip-types scripts/arc-node.ts start [--slot=1]
 *   node --experimental-strip-types scripts/arc-node.ts start [--port=8555]
 *
 * `start` runs in the foreground and is the shape the control plane wants:
 * one process it owns, terminated with a signal.
 *
 * Every resource this process binds comes from `deriveStackResources`, so the
 * launcher and the stack registry cannot disagree about which slot a running
 * chain belongs to (ADR 0028 Phase 2). With no flag the slot is the inherited
 * `POPCHARTS_STACK_SLOT`, which is what a control-plane pane already carries.
 *
 * The Arc chain still runs *alongside* the Hardhat devchain; nothing is
 * removed until ADR 0028 Phase 5.
 */

/** Everything a single `start` needs, all of it derived from one slot. */
export type ArcNodeLaunchPlan = {
  readonly args: readonly string[];
  readonly dataDir: string;
  readonly logDir: string;
  readonly resources: StackPorts;
};

/**
 * Resolves the slot to launch on from the parsed flags, falling back to the
 * inherited slot.
 *
 * `--port` is accepted because a port is what a developer has in hand when
 * they are looking at a URL, but it is resolved *back* to its slot rather than
 * used directly. Taking a port at face value is the bug this phase exists to
 * fix: the launcher would honour the HTTP port and then derive P2P, AUTH,
 * metrics, and the datadir from slot 0 anyway, which is a collision with slot
 * 0 dressed up as an isolated chain. A port outside the grid names no slot, so
 * it is rejected instead of being rounded to one.
 */
export function resolveLaunchSlot(
  flags: ReadonlyMap<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const rawSlot = flags.get("slot");
  const rawPort = flags.get("port");

  if (rawSlot !== undefined && rawPort !== undefined) {
    const port = parsePort(rawPort);
    if (deriveStackResources(parseSlot(rawSlot)).chainPort !== port) {
      throw new Error(
        `--slot=${rawSlot} and --port=${rawPort} name different stacks. ` +
          "Pass one; the other is derived from it.",
      );
    }
  }

  if (rawSlot !== undefined) {
    return parseSlot(rawSlot);
  }

  if (rawPort !== undefined) {
    const slot = slotForChainPort(parsePort(rawPort));
    if (slot === undefined) {
      throw new Error(
        `Port ${rawPort} is not a stack slot's chain port, so the rest of ` +
          "this chain's resources cannot be derived from it. Pass --slot=<n>, " +
          "or a chain port that a slot owns (8545, 8555, 8565, ...).",
      );
    }

    return slot;
  }

  return readSlotFromEnv(env);
}

/**
 * Builds the full launch plan for `slot`: the flags arc-node is started with,
 * and the directories it writes to.
 *
 * Separated from `start` so a test can assert that every per-slot resource
 * actually reaches the command line. The failure this guards against is silent
 * — an omitted `--port` leaves reth on 30303 for every slot, and nothing
 * notices until a second stack starts.
 */
export function buildArcNodeLaunchPlan(
  slot: number,
  blockTimeMs: string,
): ArcNodeLaunchPlan {
  const resources = deriveStackResources(slot);
  const dataDir = resources.chainDataDir;
  const logDir = arcChainLogDir(slot);

  return {
    args: [
      "node",
      `--chain=${ARC_LOCALDEV_CHAIN}`,
      `--datadir=${dataDir}`,
      `--ipcpath=${path.join(dataDir, "reth.ipc")}`,
      // Without an explicit log directory arc-node writes tracing output to
      // ~/.cache/reth, outside the repository. AGENTS.md forbids that without
      // approval, so it is pinned here (ADR 0028 G9).
      `--log.file.directory=${logDir}`,
      "--dev",
      `--dev.block-time=${blockTimeMs}`,
      // Not a substitute for striding --port: discovery is the peer *search*,
      // and disabling it still leaves the listener bound (ADR 0028 G7).
      "--disable-discovery",
      `--port=${resources.chainP2pPort}`,
      `--authrpc.port=${resources.chainAuthRpcPort}`,
      "--http",
      "--http.api=all",
      `--http.port=${resources.chainPort}`,
      `--metrics=${resources.chainMetricsPort}`,
      // The dev accounts hold 1,000,000 native each and local flows send
      // deliberately large values; the default 1 ETH RPC fee cap rejects them.
      "--rpc.txfeecap=1000",
    ],
    dataDir,
    logDir,
    resources,
  };
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return parsed;
}

function parseSlot(value: string): number {
  const parsed = Number(value);
  // `assertValidSlot` owns the guard and its message, so a bad `--slot` reads
  // the same here as it does from `POPCHARTS_STACK_SLOT`.
  assertValidSlot(parsed);
  return parsed;
}

async function start(slot: number, blockTimeMs: string): Promise<number> {
  const executable = await ensureArcNode();
  const plan = buildArcNodeLaunchPlan(slot, blockTimeMs);
  const { resources } = plan;

  fs.mkdirSync(plan.dataDir, { recursive: true });
  fs.mkdirSync(plan.logDir, { recursive: true });

  console.log(
    `[arc-node] ${ARC_NODE_VERSION} chain=${ARC_LOCALDEV_CHAIN} ` +
      `id=${ARC_LOCALDEV_CHAIN_ID} slot=${resources.slot} ` +
      `rpc=${resources.chainRpcHttpUrl} p2p=${resources.chainP2pPort} ` +
      `authrpc=${resources.chainAuthRpcPort} ` +
      `metrics=${resources.chainMetricsPort}`,
  );
  console.log(`[arc-node] datadir ${plan.dataDir}`);

  return await new Promise((resolve, reject) => {
    const child = spawn(executable, [...plan.args], { stdio: "inherit" });

    // Forward termination so the control plane's SIGTERM reaches the node
    // rather than orphaning it holding the datadir lock — a leaked lock makes
    // the next start fail with a message that names a PID which no longer
    // exists.
    const forward = (signal: NodeJS.Signals) => () => {
      child.kill(signal);
    };
    process.on("SIGINT", forward("SIGINT"));
    process.on("SIGTERM", forward("SIGTERM"));

    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 0));
  });
}

async function main(): Promise<number> {
  const [command = "start", ...rest] = process.argv.slice(2);
  const flags = new Map<string, string>();

  for (const arg of rest) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) {
      flags.set(match[1]!, match[2]!);
    }
  }

  if (command === "fetch") {
    const executable = await ensureArcNode({ force: flags.has("force") });
    console.log(`[arc-node] ${ARC_NODE_VERSION} ready at ${executable}`);
    return 0;
  }

  if (command === "start") {
    return await start(
      resolveLaunchSlot(flags),
      flags.get("block-time") ?? "200ms",
    );
  }

  console.error(
    `Unknown command: ${command}\nUsage: arc-node.ts <fetch|start>`,
  );
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main();
}
