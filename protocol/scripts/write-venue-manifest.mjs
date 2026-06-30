#!/usr/bin/env node

import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getAddress, isAddress } from "viem";

import { runScript } from "./shared/cli/runScript.mjs";
import { writeJson } from "./shared/json/writeJson.mjs";

const DEFAULT_DEPLOYMENT_FILE = "deployments/venue-stack.json";
const CONTRACT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const protocolRoot = resolve(scriptDir, "..");

async function main() {
  const config = loadConfig(process.argv.slice(2), process.env);
  if (config.help) {
    printHelp();
    return;
  }

  const contracts = collectContracts(config.contractSpecs);
  if (contracts.length === 0) {
    throw new Error("At least one --contract or --optional-contract entry is required.");
  }

  const manifest = {
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    generatedAt: new Date().toISOString(),
    contracts: Object.fromEntries(
      contracts.map((contract) => [contract.name, formatContractEntry(contract)]),
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
        : requirePositiveInteger(parsed.blockNumber, "--block-number").toString(),
    chainId: requirePositiveInteger(parsed.chainId || env.POPCHARTS_CHAIN_ID, "--chain-id"),
    contractSpecs: parsed.contractSpecs,
    deployer:
      parsed.deployer === undefined ? undefined : requireAddress(parsed.deployer, "--deployer"),
    help: false,
    outputFile: resolve(
      protocolRoot,
      parsed.output || env.POPCHARTS_VENUE_DEPLOYMENT_FILE || DEFAULT_DEPLOYMENT_FILE,
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

function collectContracts(contractSpecs) {
  const contracts = new Map();
  for (const contractSpec of contractSpecs) {
    const contract = parseContractSpec(contractSpec);
    if (contracts.has(contract.name)) {
      throw new Error(`Duplicate contract entry: ${contract.name}`);
    }
    contracts.set(contract.name, contract);
  }

  return [...contracts.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function parseContractSpec({ required, spec }) {
  const separatorIndex = spec.indexOf("=");
  if (separatorIndex <= 0 || separatorIndex === spec.length - 1) {
    throw new Error(`Expected contract entry to use name=address or name=address@block: ${spec}`);
  }

  const name = spec.slice(0, separatorIndex).trim();
  if (!CONTRACT_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid contract entry name: ${name}. Use letters, numbers, ".", "-", or "_".`,
    );
  }

  const addressAndBlock = spec.slice(separatorIndex + 1).trim();
  const addressParts = addressAndBlock.split("@");
  if (addressParts.length > 2) {
    throw new Error(`Invalid contract entry block suffix: ${spec}`);
  }

  const [address, block] = addressParts;
  return {
    address: requireAddress(address, name),
    deploymentBlock:
      block === undefined ? undefined : requirePositiveInteger(block, name).toString(),
    name,
    required,
  };
}

function formatContractEntry(contract) {
  const entry = {
    address: contract.address,
    required: contract.required,
  };
  if (contract.deploymentBlock !== undefined) {
    entry.deploymentBlock = contract.deploymentBlock;
  }
  return entry;
}

function readRequiredArg(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Expected a value after ${flag}.`);
  }
  return value;
}

function requireAddress(value, label) {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`Expected ${label} to be an Ethereum address.`);
  }
  return getAddress(value);
}

function requirePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected ${label} to be a positive integer.`);
  }
  return parsed;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${label} to be set.`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: node scripts/write-venue-manifest.mjs [options]

Writes a deployment manifest compatible with scripts/check-venue-deployment.mjs.

Options:
  --chain-id <id>                    Chain ID. Defaults to POPCHARTS_CHAIN_ID
  --rpc-url <url>                    RPC URL. Defaults to POPCHARTS_RPC_URL
  --manifest, --output <path>        Output path. Defaults to ${DEFAULT_DEPLOYMENT_FILE}
  --block-number <number>            Optional reference block number
  --deployer <address>               Optional deployer address
  --contract <name=address[@block]>  Required bytecode entry
  --optional-contract <name=...>     Optional bytecode entry
  -h, --help                         Show this help text
`);
}
