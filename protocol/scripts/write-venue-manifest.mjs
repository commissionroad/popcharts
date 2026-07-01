#!/usr/bin/env node

import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readRequiredArg,
  requireAddress,
  requireNonNegativeInteger,
  requirePositiveInteger,
  requireString,
} from "./shared/cli/requireCliValue.mjs";
import { runScript } from "./shared/cli/runScript.mjs";
import {
  DEFAULT_VENUE_DEPLOYMENT_FILE,
  formatVenueContractEntry,
  normalizeVenueContractEntries,
} from "./shared/deployment/venueManifest.mjs";
import { writeJson } from "./shared/json/writeJson.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const protocolRoot = resolve(scriptDir, "..");

async function main() {
  const config = loadConfig(process.argv.slice(2), process.env);
  if (config.help) {
    printHelp();
    return;
  }

  const contracts = normalizeVenueContractEntries(config.contractSpecs);
  if (contracts.length === 0) {
    throw new Error("At least one --contract or --optional-contract entry is required.");
  }

  const manifest = {
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    generatedAt: new Date().toISOString(),
    contracts: Object.fromEntries(
      contracts.map((contract) => [contract.name, formatVenueContractEntry(contract)]),
    ),
  };

  if (config.blockNumber !== undefined) {
    manifest.blockNumber = config.blockNumber;
  }
  if (config.deployer !== undefined) {
    manifest.deployer = config.deployer;
  }

  await writeJson(config.outputFile, manifest);

  const outputPath = relative(protocolRoot, config.outputFile);
  console.log(`Wrote ${outputPath}`);
  console.log(`Contracts: ${contracts.length}`);
  console.log(`Verify with: pnpm deployment:check-venue -- --manifest ${outputPath}`);
}

await runScript(main);

function loadConfig(args, env) {
  const parsed = parseArgs(args);
  if (parsed.help) {
    return { help: true };
  }

  return {
    blockNumber:
      parsed.blockNumber === undefined
        ? undefined
        : requireNonNegativeInteger(parsed.blockNumber, "--block-number").toString(),
    chainId: requirePositiveInteger(parsed.chainId || env.POPCHARTS_CHAIN_ID, "--chain-id"),
    contractSpecs: parsed.contractSpecs,
    deployer:
      parsed.deployer === undefined ? undefined : requireAddress(parsed.deployer, "--deployer"),
    help: false,
    outputFile: resolve(
      protocolRoot,
      parsed.output || env.POPCHARTS_VENUE_DEPLOYMENT_FILE || DEFAULT_VENUE_DEPLOYMENT_FILE,
    ),
    rpcUrl: requireString(parsed.rpcUrl || env.POPCHARTS_RPC_URL, "--rpc-url"),
  };
}

function parseArgs(args) {
  const parsed = {
    blockNumber: undefined,
    chainId: undefined,
    contractSpecs: [],
    deployer: undefined,
    help: false,
    output: undefined,
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
    if (arg === "--block-number") {
      parsed.blockNumber = readRequiredArg(args, ++index, arg);
      continue;
    }
    if (arg === "--chain-id") {
      parsed.chainId = readRequiredArg(args, ++index, arg);
      continue;
    }
    if (arg === "--contract") {
      parsed.contractSpecs.push({
        required: true,
        spec: readRequiredArg(args, ++index, arg),
      });
      continue;
    }
    if (arg === "--deployer") {
      parsed.deployer = readRequiredArg(args, ++index, arg);
      continue;
    }
    if (arg === "--manifest" || arg === "--output") {
      parsed.output = readRequiredArg(args, ++index, arg);
      continue;
    }
    if (arg === "--optional-contract") {
      parsed.contractSpecs.push({
        required: false,
        spec: readRequiredArg(args, ++index, arg),
      });
      continue;
    }
    if (arg === "--rpc-url") {
      parsed.rpcUrl = readRequiredArg(args, ++index, arg);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/write-venue-manifest.mjs [options]

Writes a deployment manifest compatible with scripts/check-venue-deployment.mjs.

Options:
  --chain-id <id>                    Chain ID. Defaults to POPCHARTS_CHAIN_ID
  --rpc-url <url>                    RPC URL. Defaults to POPCHARTS_RPC_URL
  --manifest, --output <path>        Output path. Defaults to ${DEFAULT_VENUE_DEPLOYMENT_FILE}
  --block-number <number>            Optional reference block number
  --deployer <address>               Optional deployer address
  --contract <name=address[@block]>  Required bytecode entry
  --optional-contract <name=...>     Optional bytecode entry
  -h, --help                         Show this help text
`);
}
