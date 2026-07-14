import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, getAddress, http } from "viem";
import type { Address, Hash, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { normalizePrivateKey } from "./shared/account/normalizePrivateKey.js";
import { loadHardhatDeployableArtifact } from "./shared/artifact/loadHardhatDeployableArtifact.js";
import { defineEvmChain } from "./shared/chain/defineEvmChain.js";
import { runScript } from "./shared/cli/runScript.js";
import { deployBytecodeContract } from "./shared/contract/deployBytecodeContract.js";
import { updateDevchainEnvBlock } from "./shared/env/updateDevchainEnvBlock.js";
import { writeJsonFile } from "./shared/json/jsonFile.js";
import { createViemClients } from "./shared/viem/createViemClients.js";

const DEFAULT_RPC_URL = "http://127.0.0.1:8545";
// Hardhat's well-known dev account #0; only ever used against a local node.
const DEFAULT_HARDHAT_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const HARDHAT_LOCAL_CHAIN_ID = 31337;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const protocolRoot = resolve(scriptDir, "..");
const repoRoot = resolve(protocolRoot, "..");

type DevchainContract = {
  address: Address;
  transactionHash: Hash;
};

type DevchainManifest = {
  chainEnv: string;
  chainId: number;
  contracts: {
    collateral: DevchainContract;
    pregradManager: DevchainContract;
  };
  deployer: Address;
  generatedAt: string;
  rpcUrl: string;
};

/**
 * Deploys the mock collateral and PregradManager to a local devchain, writes
 * the local deployment manifest, and refreshes the app's dev env block.
 */
async function main(): Promise<void> {
  const rpcUrl = process.env.POPCHARTS_RPC_URL ?? DEFAULT_RPC_URL;
  const privateKey = normalizePrivateKey(
    process.env.POPCHARTS_DEPLOYER_PRIVATE_KEY ?? DEFAULT_HARDHAT_PRIVATE_KEY,
    { label: "POPCHARTS_DEPLOYER_PRIVATE_KEY" },
  );
  const account = privateKeyToAccount(privateKey);

  // The chain id comes from the node itself, so probe before defining the chain.
  const chainId = await createPublicClient({ transport: http(rpcUrl) }).getChainId();
  const chain = defineEvmChain({
    chainId,
    name: chainId === HARDHAT_LOCAL_CHAIN_ID ? "Hardhat Local" : `Pop Charts Devchain ${chainId}`,
    nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
    rpcUrl,
  });
  const { publicClient, walletClient } = createViemClients({ account, chain, rpcUrl });

  const mockCollateralArtifact = await loadHardhatDeployableArtifact({
    artifactPath: resolve(
      protocolRoot,
      "artifacts/contracts/mocks/MockCollateral.sol/MockCollateral.json",
    ),
    contractName: "MockCollateral",
  });
  const pregradManagerArtifact = await loadHardhatDeployableArtifact({
    artifactPath: resolve(
      protocolRoot,
      "artifacts/contracts/PregradManager.sol/PregradManager.json",
    ),
    contractName: "PregradManager",
  });

  console.log(`Deploying Pop Charts devchain contracts to chain ${chainId}`);
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Deployer: ${getAddress(account.address)}`);

  const collateral = await deployDevchainContract("MockCollateral", mockCollateralArtifact);
  const pregradManager = await deployDevchainContract("PregradManager", pregradManagerArtifact);

  const manifest: DevchainManifest = {
    chainEnv: process.env.NEXT_PUBLIC_POPCHARTS_CHAIN_ENV ?? "local",
    chainId,
    contracts: {
      collateral,
      pregradManager,
    },
    deployer: getAddress(account.address),
    generatedAt: new Date().toISOString(),
    rpcUrl,
  };

  const deploymentFile =
    process.env.POPCHARTS_DEPLOYMENT_FILE ??
    resolve(protocolRoot, "deployments", "devchain.local.json");
  await writeJsonFile(deploymentFile, manifest);
  console.log(`Wrote deployment manifest: ${deploymentFile}`);

  if (process.env.POPCHARTS_WRITE_APP_ENV !== "false") {
    const appEnvFile =
      process.env.POPCHARTS_APP_ENV_FILE ?? resolve(repoRoot, "app", ".env.development.local");
    await writeAppEnvBlock(appEnvFile, manifest, privateKey);
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

  async function deployDevchainContract(
    name: string,
    artifact: Awaited<ReturnType<typeof loadHardhatDeployableArtifact>>,
  ): Promise<DevchainContract> {
    const deployment = await deployBytecodeContract({
      artifact,
      contractName: name,
      publicClient,
      walletClient,
    });
    console.log(`${name}: ${deployment.address} (${deployment.transactionHash})`);

    return {
      address: deployment.address,
      transactionHash: deployment.transactionHash,
    };
  }
}

await runScript(main);

/**
 * Rewrites only the marked devchain block in the app env file so developer
 * overrides outside the block survive redeploys.
 */
async function writeAppEnvBlock(
  path: string,
  deployment: DevchainManifest,
  privateKey: Hex,
): Promise<void> {
  const existing = await readOptionalFile(path);
  const next = updateDevchainEnvBlock({
    entries: [
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
    ],
    existing,
  });

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, next);
}

async function readOptionalFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}
