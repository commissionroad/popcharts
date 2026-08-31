import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ARC_LOCALDEV_CHAIN,
  ARC_LOCALDEV_CHAIN_ID,
  ARC_NODE_VERSION,
} from "./shared/chain/arcNodeRelease.ts";
import {
  DEFAULT_ARC_HTTP_PORT,
  deriveArcNodePorts,
} from "./shared/chain/arcNodePorts.ts";
import { ensureArcNode } from "./shared/chain/ensureArcNode.ts";
import { repoRoot } from "./shared/paths.ts";

/**
 * Fetches and runs the pinned Arc node as a local devchain.
 *
 * Usage:
 *   node --experimental-strip-types scripts/arc-node.ts fetch
 *   node --experimental-strip-types scripts/arc-node.ts start [--port=8545]
 *
 * `start` runs in the foreground and is the shape the control plane wants:
 * one process it owns, terminated with a signal.
 *
 * This is ADR 0028 Phase 1 — the Arc chain runs *alongside* the Hardhat
 * devchain, nothing is removed yet, and slot-awareness (per-slot ports and
 * datadirs) is Phase 2. Until then this launcher takes explicit ports so it
 * can be driven manually without colliding with a running stack.
 */

/** Per-instance state directory, keyed by HTTP port so instances never share. */
function instanceDir(httpPort: number): string {
  return path.join(repoRoot, ".local-dev", "arc-chain", String(httpPort));
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return parsed;
}

async function start(httpPort: number, blockTimeMs: string): Promise<number> {
  const executable = await ensureArcNode();
  const ports = deriveArcNodePorts(httpPort);
  const dir = instanceDir(httpPort);
  const dataDir = path.join(dir, "data");
  const logDir = path.join(dir, "logs");

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const args = [
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
    "--disable-discovery",
    `--port=${ports.p2p}`,
    `--authrpc.port=${ports.authrpc}`,
    "--http",
    "--http.api=all",
    `--http.port=${ports.http}`,
    `--metrics=${ports.metrics}`,
    // The dev accounts hold 1,000,000 native each and local flows send
    // deliberately large values; the default 1 ETH RPC fee cap rejects them.
    "--rpc.txfeecap=1000",
  ];

  console.log(
    `[arc-node] ${ARC_NODE_VERSION} chain=${ARC_LOCALDEV_CHAIN} ` +
      `id=${ARC_LOCALDEV_CHAIN_ID} rpc=http://127.0.0.1:${ports.http} ` +
      `p2p=${ports.p2p} authrpc=${ports.authrpc} metrics=${ports.metrics}`,
  );
  console.log(`[arc-node] datadir ${dataDir}`);

  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: "inherit" });

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
      parsePort(flags.get("port"), DEFAULT_ARC_HTTP_PORT),
      flags.get("block-time") ?? "200ms",
    );
  }

  console.error(`Unknown command: ${command}\nUsage: arc-node.ts <fetch|start>`);
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main();
}
