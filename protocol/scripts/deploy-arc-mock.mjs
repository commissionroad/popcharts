#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getAddress, parseGwei } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { assertNativeBalance } from "./shared/account/assertNativeBalance.mjs";
import { normalizePrivateKey } from "./shared/account/normalizePrivateKey.mjs";
import { loadHardhatDeployableArtifact } from "./shared/artifact/loadHardhatDeployableArtifact.mjs";
import { assertExpectedChain } from "./shared/chain/assertExpectedChain.mjs";
import { defineEvmChain } from "./shared/chain/defineEvmChain.mjs";
import { runScript } from "./shared/cli/runScript.mjs";
import { deployBytecodeContract } from "./shared/contract/deployBytecodeContract.mjs";
import { contractExplorerUrl } from "./shared/explorer/contractExplorerUrl.mjs";
import { verifyBlockscoutStandardJson } from "./shared/explorer/verifyBlockscoutStandardJson.mjs";
import { writeJson } from "./shared/json/writeJson.mjs";
import { printDeploymentHeader } from "./shared/log/printDeploymentHeader.mjs";
import { createViemClients } from "./shared/viem/createViemClients.mjs";

const ARC_TESTNET = {
  chainEnv: "arc-testnet",
  chainId: 5_042_002,
  name: "Arc Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "USDC",
    symbol: "USDC",
  },
};

const ARCSCAN = {
  apiUrl: "https://testnet.arcscan.app/api",
  browserUrl: "https://testnet.arcscan.app",
  name: "ArcScan",
};

const MOCK_COLLATERAL = {
  artifactPath: "artifacts/contracts/mocks/MockCollateral.sol/MockCollateral.json",
  manifestKey: "mockCollateral",
  name: "MockCollateral",
};

const DEFAULT_RPC_URL = "https://rpc.testnet.arc.network";
const DEFAULT_DEPLOYMENT_FILE = "deployments/arc-testnet.mock.local.json";
const DEFAULT_VERIFY_POLL_INTERVAL_MS = 4_000;
const DEFAULT_VERIFY_POLL_ATTEMPTS = 30;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const protocolRoot = resolve(scriptDir, "..");

/**
 * Deploys the test-only mock ERC-20 collateral to Arc Testnet and verifies the
 * source on ArcScan. Arc-specific config stays in this entrypoint; reusable
 * deployment, artifact, manifest, and Blockscout helpers live under
 * scripts/shared so future network scripts can pass their own chain config.
 */
async function main() {
  const config = loadConfig(process.env);
  const account = privateKeyToAccount(config.privateKey);
  const chain = defineEvmChain(config.chain);
  const { publicClient, walletClient } = createViemClients({
    account,
    chain,
    rpcUrl: config.chain.rpcUrl,
  });
  const artifact = await loadHardhatDeployableArtifact({
    artifactPath: config.contract.artifactPath,
    contractName: config.contract.name,
  });

  const chainId = await assertExpectedChain({
    chainName: config.chain.name,
    expectedChainId: config.chain.chainId,
    publicClient,
  });
  const balance = await assertNativeBalance({
    chainName: config.chain.name,
    currencySymbol: config.chain.nativeCurrency.symbol,
    deployerAddress: account.address,
    publicClient,
  });

  printDeploymentHeader({
    balance,
    chainId,
    chainName: config.chain.name,
    contractName: config.contract.name,
    currencyDecimals: config.chain.nativeCurrency.decimals,
    currencySymbol: config.chain.nativeCurrency.symbol,
    deployerAddress: account.address,
    rpcUrl: config.chain.rpcUrl,
  });

  const deployment = await deployBytecodeContract({
    artifact,
    contractName: config.contract.name,
    publicClient,
    txFees: config.txFees,
    walletClient,
  });
  const explorerUrl = contractExplorerUrl({
    address: deployment.address,
    browserUrl: config.explorer.browserUrl,
  });
  const manifest = {
    chainEnv: config.chain.chainEnv,
    chainId,
    contracts: {
      [config.contract.manifestKey]: deployment,
    },
    deployer: getAddress(account.address),
    explorerUrl,
    generatedAt: new Date().toISOString(),
    rpcUrl: config.chain.rpcUrl,
  };

  console.log(`${config.contract.name}: ${deployment.address}`);
  console.log(`Transaction: ${deployment.transactionHash}`);

  await writeJson(config.deploymentFile, manifest);
  console.log(`Wrote deployment manifest: ${config.deploymentFile}`);

  if (config.shouldVerify) {
    const verification = await verifyBlockscoutStandardJson({
      address: deployment.address,
      apiUrl: config.explorer.apiUrl,
      artifact,
      buildInfoRoot: config.buildInfoRoot,
      explorerName: config.explorer.name,
      licenseType: "3",
      pollAttempts: config.verification.pollAttempts,
      pollIntervalMs: config.verification.pollIntervalMs,
    });
    console.log(`Verification: ${verification.result}`);
  }

  console.log(`Explorer: ${explorerUrl}`);
}

await runScript(main);

/**
 * Reads Arc deploy settings from the environment and resolves repo-local paths.
 */
function loadConfig(env) {
  const rpcUrl = env.POPCHARTS_RPC_URL || DEFAULT_RPC_URL;
  const browserUrl = env.POPCHARTS_ARCSCAN_BROWSER_URL || ARCSCAN.browserUrl;

  return {
    buildInfoRoot: resolve(protocolRoot, "artifacts", "build-info"),
    chain: {
      ...ARC_TESTNET,
      blockExplorer: {
        name: ARCSCAN.name,
        url: browserUrl,
      },
      rpcUrl,
    },
    contract: {
      ...MOCK_COLLATERAL,
      artifactPath: resolve(protocolRoot, MOCK_COLLATERAL.artifactPath),
    },
    deploymentFile: resolve(protocolRoot, env.POPCHARTS_DEPLOYMENT_FILE || DEFAULT_DEPLOYMENT_FILE),
    explorer: {
      apiUrl: env.POPCHARTS_ARCSCAN_API_URL || ARCSCAN.apiUrl,
      browserUrl,
      name: ARCSCAN.name,
    },
    privateKey: normalizePrivateKey(env.POPCHARTS_DEPLOYER_PRIVATE_KEY, {
      label: "POPCHARTS_DEPLOYER_PRIVATE_KEY",
    }),
    shouldVerify: env.POPCHARTS_VERIFY_CONTRACTS !== "false",
    txFees: {
      maxFeePerGas: parseGwei(env.POPCHARTS_MAX_FEE_GWEI || "25"),
      maxPriorityFeePerGas: parseGwei(env.POPCHARTS_PRIORITY_FEE_GWEI || "1"),
    },
    verification: {
      pollAttempts: Number(env.POPCHARTS_VERIFY_POLL_ATTEMPTS || DEFAULT_VERIFY_POLL_ATTEMPTS),
      pollIntervalMs: Number(
        env.POPCHARTS_VERIFY_POLL_INTERVAL_MS || DEFAULT_VERIFY_POLL_INTERVAL_MS,
      ),
    },
  };
}
