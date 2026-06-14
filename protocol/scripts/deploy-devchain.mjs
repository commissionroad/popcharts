#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, createWalletClient, defineChain, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DEFAULT_RPC_URL = "http://127.0.0.1:8545";
const DEFAULT_HARDHAT_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const APP_ENV_START = "# BEGIN POPCHARTS DEVCHAIN";
const APP_ENV_END = "# END POPCHARTS DEVCHAIN";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const protocolRoot = resolve(scriptDir, "..");
const repoRoot = resolve(protocolRoot, "..");

const rpcUrl = process.env.POPCHARTS_RPC_URL ?? DEFAULT_RPC_URL;
const privateKey = normalizePrivateKey(
  process.env.POPCHARTS_DEPLOYER_PRIVATE_KEY ?? DEFAULT_HARDHAT_PRIVATE_KEY,
);
const account = privateKeyToAccount(privateKey);

const publicClient = createPublicClient({
  transport: http(rpcUrl),
});

const chainId = await publicClient.getChainId();
const chain = defineChain({
  id: chainId,
  name: chainId === 31337 ? "Hardhat Local" : `Pop Charts Devchain ${chainId}`,
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: [rpcUrl],
    },
  },
});
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(rpcUrl),
});

const mockCollateralArtifact = await readArtifact(
  "artifacts/contracts/mocks/MockCollateral.sol/MockCollateral.json",
);
const pregradManagerArtifact = await readArtifact(
  "artifacts/contracts/PregradManager.sol/PregradManager.json",
);

console.log(`Deploying Pop Charts devchain contracts to chain ${chainId}`);
console.log(`RPC: ${rpcUrl}`);
console.log(`Deployer: ${getAddress(account.address)}`);

const collateral = await deployContract("MockCollateral", mockCollateralArtifact);
const pregradManager = await deployContract("PregradManager", pregradManagerArtifact);

const manifest = {
  chainEnv: process.env.NEXT_PUBLIC_POPCHARTS_CHAIN_ENV ?? "local",
  chainId,
  contracts: {
    collateral: {
      address: collateral.address,
      transactionHash: collateral.transactionHash,
    },
    pregradManager: {
      address: pregradManager.address,
      transactionHash: pregradManager.transactionHash,
    },
  },
  deployer: getAddress(account.address),
  generatedAt: new Date().toISOString(),
  rpcUrl,
};

const deploymentFile =
  process.env.POPCHARTS_DEPLOYMENT_FILE ??
  resolve(protocolRoot, "deployments", "devchain.local.json");
await writeJson(deploymentFile, manifest);
console.log(`Wrote deployment manifest: ${deploymentFile}`);

if (process.env.POPCHARTS_WRITE_APP_ENV !== "false") {
  const appEnvFile =
    process.env.POPCHARTS_APP_ENV_FILE ?? resolve(repoRoot, "app", ".env.development.local");
  await writeAppEnv(appEnvFile, manifest);
  console.log(`Updated app dev env: ${appEnvFile}`);
}

console.log("");
console.log("Vercel Preview values:");
console.log(`NEXT_PUBLIC_POPCHARTS_CHAIN_ENV=preview`);
console.log(`NEXT_PUBLIC_POPCHARTS_MARKET_CREATION_MODE=devchain`);
console.log(`NEXT_PUBLIC_POPCHARTS_CHAIN_ID=${chainId}`);
console.log(`NEXT_PUBLIC_POPCHARTS_RPC_URL=${rpcUrl}`);
console.log(
  `NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS=${manifest.contracts.pregradManager.address}`,
);
console.log(`NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=${manifest.contracts.collateral.address}`);
console.log(`POPCHARTS_DEVCHAIN_ENABLED=true`);
console.log("POPCHARTS_DEVCHAIN_PRIVATE_KEY=<preview deployer private key>");

async function deployContract(name, artifact) {
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (!receipt.contractAddress) {
    throw new Error(`${name} deployment did not return a contract address.`);
  }

  const address = getAddress(receipt.contractAddress);
  console.log(`${name}: ${address} (${hash})`);

  return {
    address,
    transactionHash: hash,
  };
}

async function readArtifact(relativePath) {
  const artifactPath = resolve(protocolRoot, relativePath);
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));

  if (!artifact.abi || !artifact.bytecode || artifact.bytecode === "0x") {
    throw new Error(`Invalid contract artifact: ${artifactPath}`);
  }

  return artifact;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeAppEnv(path, deployment) {
  const existing = await readOptional(path);
  const block = [
    APP_ENV_START,
    "NEXT_PUBLIC_POPCHARTS_CHAIN_ENV=local",
    "NEXT_PUBLIC_POPCHARTS_MARKET_CREATION_MODE=devchain",
    "NEXT_PUBLIC_POPCHARTS_MARKET_CREATION_SIGNER=server",
    `NEXT_PUBLIC_POPCHARTS_CHAIN_ID=${deployment.chainId}`,
    `NEXT_PUBLIC_POPCHARTS_RPC_URL=${deployment.rpcUrl}`,
    `NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS=${deployment.contracts.pregradManager.address}`,
    `NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=${deployment.contracts.collateral.address}`,
    "NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN=true",
    "POPCHARTS_DEVCHAIN_ENABLED=true",
    `POPCHARTS_DEVCHAIN_PRIVATE_KEY=${privateKey}`,
    APP_ENV_END,
    "",
  ].join("\n");

  const pattern = new RegExp(
    `${escapeRegExp(APP_ENV_START)}[\\s\\S]*?${escapeRegExp(APP_ENV_END)}\\n?`,
    "m",
  );
  const next = pattern.test(existing)
    ? existing.replace(pattern, block)
    : `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${block}`;

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, next);
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

function normalizePrivateKey(value) {
  const key = value.startsWith("0x") ? value : `0x${value}`;

  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("Expected POPCHARTS_DEPLOYER_PRIVATE_KEY to be a 32-byte hex key.");
  }

  return key;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
