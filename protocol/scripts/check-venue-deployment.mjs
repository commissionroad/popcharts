#!/usr/bin/env node

import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, http } from "viem";

import {
  readRequiredArg,
  requirePositiveInteger,
  requireString,
} from "./shared/cli/requireCliValue.mjs";
import { runScript } from "./shared/cli/runScript.mjs";
import {
  collectVenueAddressEntries,
  DEFAULT_VENUE_DEPLOYMENT_FILE,
} from "./shared/deployment/venueManifest.mjs";
import { readJson } from "./shared/json/readJson.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const protocolRoot = resolve(scriptDir, "..");

async function main() {
  const config = loadConfig(process.argv.slice(2), process.env);
  if (config.help) {
    printHelp();
    return;
  }

  const manifest = await readJson(config.deploymentFile);
  const rpcUrl = config.rpcUrl || requireString(manifest.rpcUrl, "manifest.rpcUrl");
  const expectedChainId =
    config.expectedChainId ?? requirePositiveInteger(manifest.chainId, "manifest.chainId");
  const entries = collectVenueAddressEntries(manifest, config.requiredKeys);
  if (entries.length === 0) {
    throw new Error(
      `No contract addresses found in ${relative(protocolRoot, config.deploymentFile)}.`,
    );
  }

  const client = createPublicClient({
    transport: http(rpcUrl),
  });
  const chainId = await client.getChainId();
  if (chainId !== expectedChainId) {
    throw new Error(`Connected to chain ${chainId}, expected ${expectedChainId}.`);
  }

  const blockNumber = await client.getBlockNumber();
  const results = await Promise.all(
    entries.map(async (entry) => {
      const bytecode = await client.getBytecode({ address: entry.address });
      const byteLength = bytecodeLength(bytecode);
      return {
        ...entry,
        byteLength,
      };
    }),
  );
  const failures = results.filter((result) => result.required && result.byteLength === 0);

  console.log(`Manifest: ${relative(protocolRoot, config.deploymentFile)}`);
  console.log(`Chain ID: ${chainId}`);
  console.log(`Block: ${blockNumber}`);
  for (const result of results) {
    const required = result.required ? "required" : "optional";
    console.log(
      `${result.name}: ${result.address} bytecode=${result.byteLength} bytes (${required})`,
    );
  }

  if (failures.length !== 0) {
    throw new Error(
      `Missing bytecode for required address entries: ${failures
        .map((failure) => failure.name)
        .join(", ")}`,
    );
  }
}

await runScript(main);

function loadConfig(args, env) {
  const parsed = parseArgs(args);
  const deploymentFile = resolve(
    protocolRoot,
    parsed.manifest || env.POPCHARTS_VENUE_DEPLOYMENT_FILE || DEFAULT_VENUE_DEPLOYMENT_FILE,
  );

  return {
    deploymentFile,
    expectedChainId: parsed.expectedChainId,
    help: parsed.help,
    requiredKeys: parsed.requiredKeys,
    rpcUrl: parsed.rpcUrl || env.POPCHARTS_RPC_URL,
  };
}

function parseArgs(args) {
  const parsed = {
    expectedChainId: undefined,
    help: false,
    manifest: undefined,
    requiredKeys: undefined,
    rpcUrl: undefined,
  };

  for (let index = 0; index < args.length; ++index) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--manifest") {
      parsed.manifest = readRequiredArg(args, ++index, arg);
      continue;
    }
    if (arg === "--rpc-url") {
      parsed.rpcUrl = readRequiredArg(args, ++index, arg);
      continue;
    }
    if (arg === "--expected-chain-id") {
      parsed.expectedChainId = requirePositiveInteger(readRequiredArg(args, ++index, arg), arg);
      continue;
    }
    if (arg === "--require") {
      parsed.requiredKeys = new Set(
        readRequiredArg(args, ++index, arg)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      );
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function bytecodeLength(bytecode) {
  return bytecode ? (bytecode.length - 2) / 2 : 0;
}

function printHelp() {
  console.log(`Usage: node scripts/check-venue-deployment.mjs [options]

Checks that configured deployment manifest addresses have bytecode at the
connected RPC endpoint.

Options:
  --manifest <path>            Manifest path. Defaults to ${DEFAULT_VENUE_DEPLOYMENT_FILE}
  --rpc-url <url>              RPC URL. Defaults to POPCHARTS_RPC_URL or manifest.rpcUrl
  --expected-chain-id <id>     Expected chain ID. Defaults to manifest.chainId
  --require <names>            Comma-separated manifest entry names that must have bytecode
  -h, --help                   Show this help text
`);
}
