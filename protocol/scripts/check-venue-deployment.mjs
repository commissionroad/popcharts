#!/usr/bin/env node

import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, getAddress, http, isAddress } from "viem";

import { runScript } from "./shared/cli/runScript.mjs";
import { readJson } from "./shared/json/readJson.mjs";

const DEFAULT_DEPLOYMENT_FILE = "deployments/venue-stack.json";
const ADDRESS_CONTAINERS = ["contracts", "addresses", "probes"];
const NON_CONTRACT_ADDRESS_FIELDS = new Set([
  "admin",
  "deployer",
  "feeRecipient",
  "owner",
  "resolver",
]);

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
    config.expectedChainId || requirePositiveInteger(manifest.chainId, "manifest.chainId");
  const entries = collectAddressEntries(manifest, config.requiredKeys);
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
    parsed.manifest || env.POPCHARTS_VENUE_DEPLOYMENT_FILE || DEFAULT_DEPLOYMENT_FILE,
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

function readRequiredArg(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Expected a value after ${flag}.`);
  }
  return value;
}

function collectAddressEntries(manifest, requiredKeys) {
  const entries = new Map();
  collectTopLevelAddressEntries({ entries, manifest, requiredKeys });
  for (const container of ADDRESS_CONTAINERS) {
    collectContainerAddressEntries({
      entries,
      path: [container],
      requiredKeys,
      value: manifest[container],
    });
  }

  if (requiredKeys) {
    for (const requiredKey of requiredKeys) {
      if (!entries.has(requiredKey)) {
        entries.set(requiredKey, {
          address: "0x0000000000000000000000000000000000000000",
          name: requiredKey,
          required: true,
        });
      }
    }
  }

  return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function collectTopLevelAddressEntries({ entries, manifest, requiredKeys }) {
  if (!isPlainObject(manifest)) {
    return;
  }

  for (const [key, value] of Object.entries(manifest)) {
    if (
      ADDRESS_CONTAINERS.includes(key) ||
      NON_CONTRACT_ADDRESS_FIELDS.has(key) ||
      !isAddressLike(value)
    ) {
      continue;
    }
    addAddressEntry({
      entries,
      name: key,
      required: requiredKeys ? requiredKeys.has(key) : true,
      value,
    });
  }
}

function collectContainerAddressEntries({ entries, path, requiredKeys, value }) {
  if (!isPlainObject(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const name = [...path, key].slice(1).join(".");
    if (isAddressLike(child)) {
      addAddressEntry({
        entries,
        name,
        required: requiredKeys ? requiredKeys.has(name) : true,
        value: child,
      });
      continue;
    }
    if (isPlainObject(child) && isAddressLike(child.address)) {
      addAddressEntry({
        entries,
        name,
        required: requiredKeys ? requiredKeys.has(name) : child.required !== false,
        value: child.address,
      });
      continue;
    }
    collectContainerAddressEntries({
      entries,
      path: [...path, key],
      requiredKeys,
      value: child,
    });
  }
}

function addAddressEntry({ entries, name, required, value }) {
  const address = getAddress(value);
  entries.set(name, {
    address,
    name,
    required,
  });
}

function isAddressLike(value) {
  return typeof value === "string" && isAddress(value);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytecodeLength(bytecode) {
  return bytecode ? (bytecode.length - 2) / 2 : 0;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${label} to be set.`);
  }
  return value;
}

function requirePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected ${label} to be a positive integer.`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/check-venue-deployment.mjs [options]

Checks that configured deployment manifest addresses have bytecode at the
connected RPC endpoint.

Options:
  --manifest <path>            Manifest path. Defaults to ${DEFAULT_DEPLOYMENT_FILE}
  --rpc-url <url>              RPC URL. Defaults to POPCHARTS_RPC_URL or manifest.rpcUrl
  --expected-chain-id <id>     Expected chain ID. Defaults to manifest.chainId
  --require <names>            Comma-separated manifest entry names that must have bytecode
  -h, --help                   Show this help text
`);
}
