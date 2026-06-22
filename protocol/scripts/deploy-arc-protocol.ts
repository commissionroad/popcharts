import { HardhatArtifactResolver } from "@nomicfoundation/hardhat-ignition/helpers";
import hre, { network, tasks } from "hardhat";
import { resolve } from "node:path";
import type { Address } from "viem";

import ArcProtocolModule from "../ignition/modules/ArcProtocol.js";
import { assertNativeBalance } from "./shared/account/assertNativeBalance.mjs";
import { getWalletClientAddress } from "./shared/account/getWalletClientAddress.js";
import { ARC_TESTNET } from "./shared/chain/arcTestnet.mjs";
import { ARC_PROTOCOL_DEPLOYMENT } from "./shared/deployment/arcProtocol.mjs";
import { ARCSCAN } from "./shared/explorer/arcscan.mjs";
import { assertHardhatNetwork } from "./shared/hardhat/assertHardhatNetwork.js";
import {
  buildContractDeployments,
  type ContractDeploymentManifest,
} from "./shared/ignition/buildContractDeployments.js";
import { verifyIgnitionDeployment } from "./shared/ignition/verifyIgnitionDeployment.js";
import { writeJson } from "./shared/json/writeJson.mjs";
import { printDeploymentHeader } from "./shared/log/printDeploymentHeader.mjs";

/**
 * Deploys and verifies the Arc Testnet protocol through Hardhat Ignition.
 *
 * Ignition owns contract deployment, reconciliation, and resume state. This
 * wrapper keeps Arc-specific preflight checks, writes the app/operator manifest,
 * and delegates verification to Hardhat's Ignition verification task.
 */
async function main() {
  const config = loadConfig(process.env);
  const connection = await network.create();
  const publicClient = await connection.viem.getPublicClient();
  const [walletClient] = await connection.viem.getWalletClients();
  const deployerAddress = getWalletClientAddress({
    missingMessage:
      "Expected Hardhat network arcTestnet to expose a deployer account. Set POPCHARTS_DEPLOYER_PRIVATE_KEY.",
    walletClient,
  });
  const chainId = await assertHardhatNetwork({
    expectedChainId: ARC_TESTNET.chainId,
    expectedNetworkName: config.networkName,
    networkName: connection.networkName,
    publicClient,
  });
  const balance = await assertNativeBalance({
    chainName: ARC_TESTNET.name,
    currencySymbol: ARC_TESTNET.nativeCurrency.symbol,
    deployerAddress,
    publicClient,
  });

  printDeploymentHeader({
    balance,
    chainId,
    chainName: ARC_TESTNET.name,
    contractName: "Pop Charts protocol contracts",
    currencyDecimals: ARC_TESTNET.nativeCurrency.decimals,
    currencySymbol: ARC_TESTNET.nativeCurrency.symbol,
    deployerAddress,
    rpcUrl: config.rpcUrl,
  });

  const deployedContracts = await connection.ignition.deploy(ArcProtocolModule, {
    defaultSender: deployerAddress,
    deploymentId: config.deploymentId,
    displayUi: true,
  });
  const contractDeployments = await buildContractDeployments({
    artifactResolver: new HardhatArtifactResolver(hre.artifacts),
    browserUrl: config.browserUrl,
    contracts: deployedContracts as Record<string, { address: Address }>,
    deploymentDir: config.ignitionDeploymentDir,
    descriptors: ARC_PROTOCOL_DEPLOYMENT.contracts,
    publicClient,
  });
  const manifest = {
    chainEnv: ARC_TESTNET.chainEnv,
    chainId,
    contracts: contractDeployments,
    deployer: deployerAddress,
    explorer: {
      browserUrl: config.browserUrl,
      name: ARCSCAN.name,
    },
    generatedAt: new Date().toISOString(),
    hardhat: {
      deploymentId: config.deploymentId,
      ignitionDeploymentDir: config.ignitionDeploymentDir,
      network: config.networkName,
    },
    rpcUrl: config.rpcUrl,
    verification: config.shouldVerify
      ? {
          deploymentId: config.deploymentId,
          provider: "hardhat-verify:blockscout",
          status: "pending",
        }
      : {
          status: "skipped",
        },
  } satisfies ArcProtocolManifest;

  await writeJson(config.deploymentFile, manifest);
  console.log(`Wrote deployment manifest: ${config.deploymentFile}`);

  if (config.shouldVerify) {
    await verifyIgnitionDeployment({
      deploymentId: config.deploymentId,
      tasks,
    });
    const verifiedManifest = {
      ...manifest,
      verification: {
        completedAt: new Date().toISOString(),
        deploymentId: config.deploymentId,
        provider: "hardhat-verify:blockscout",
        status: "complete",
      },
    };
    await writeJson(config.deploymentFile, verifiedManifest);
    console.log(`Updated manifest with verification status: ${config.deploymentFile}`);
  }
}

await main();

type ArcProtocolManifest = {
  chainEnv: string;
  chainId: number;
  contracts: Record<string, ContractDeploymentManifest>;
  deployer: Address;
  explorer: {
    browserUrl: string;
    name: string;
  };
  generatedAt: string;
  hardhat: {
    deploymentId: string;
    ignitionDeploymentDir: string;
    network: string;
  };
  rpcUrl: string;
  verification:
    | {
        deploymentId: string;
        provider: string;
        status: "pending";
      }
    | {
        status: "skipped";
      };
};

/**
 * Reads Arc operator settings and resolves repo-local output paths.
 */
function loadConfig(env: NodeJS.ProcessEnv) {
  const deploymentId =
    env.POPCHARTS_IGNITION_DEPLOYMENT_ID || ARC_PROTOCOL_DEPLOYMENT.defaultDeploymentId;
  const browserUrl = env.POPCHARTS_ARCSCAN_BROWSER_URL || ARCSCAN.browserUrl;

  return {
    browserUrl,
    deploymentFile: resolve(
      hre.config.paths.root,
      env.POPCHARTS_DEPLOYMENT_FILE || ARC_PROTOCOL_DEPLOYMENT.defaultDeploymentFile,
    ),
    deploymentId,
    ignitionDeploymentDir: resolve(hre.config.paths.ignition, "deployments", deploymentId),
    networkName: "arcTestnet",
    rpcUrl: env.POPCHARTS_RPC_URL || ARC_TESTNET.rpcUrl,
    shouldVerify: env.POPCHARTS_VERIFY_CONTRACTS !== "false",
  };
}
