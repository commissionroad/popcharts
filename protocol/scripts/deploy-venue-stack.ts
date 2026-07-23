import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import hre, { network, tasks } from "hardhat";
import type { Address, PublicClient } from "viem";

import VenueStackModule from "../ignition/modules/VenueStack.js";
import { assertNativeBalance } from "./shared/account/assertNativeBalance.js";
import type { DeploymentChainProfile } from "./shared/chain/resolveDeploymentChainProfile.js";
import { initializeWalletScriptEnvironment } from "./shared/cli/initializeScriptEnvironment.js";
import { LOCAL_DEVCHAIN_CHAIN_ID } from "../src/chain/localDevchain.js";
import {
  ensureDeterministicFactory,
  hasBytecode,
} from "./shared/deployment/deterministicFactory.js";
import { resolveDeploymentManifestFile } from "./shared/deployment/resolveDeploymentManifestFile.js";
import { VENUE_STACK_DEPLOYMENT } from "../src/deployment/venueStackDeployment.js";
import { verifyIgnitionDeployment } from "./shared/ignition/verifyIgnitionDeployment.js";
import { printDeploymentHeader } from "./shared/log/printDeploymentHeader.js";
import { writeVenueManifest } from "./write-venue-manifest.js";

/**
 * Deploys the self-hosted v4 venue stack (PoolManager, StateView, V4Quoter,
 * MinimalV4SwapRouter) through Hardhat Ignition and writes the venue manifest
 * consumed by `pnpm deployment:check-venue`.
 */
async function main() {
  const {
    account: deployerAddress,
    chainId,
    config,
    connection,
    profile,
    publicClient,
    walletClient,
  } = await initializeWalletScriptEnvironment({
    accountRole: "deployer",
    loadConfig: (profile) => loadConfig(process.env, profile),
    network,
  });
  const balance = await assertNativeBalance({
    chainName: profile.chainName,
    currencySymbol: profile.nativeCurrency.symbol,
    deployerAddress,
    publicClient,
  });

  printDeploymentHeader({
    balance,
    chainId,
    chainName: profile.chainName,
    contractName: "Pop Charts v4 venue stack",
    currencyDecimals: profile.nativeCurrency.decimals,
    currencySymbol: profile.nativeCurrency.symbol,
    deployerAddress,
    rpcUrl: config.rpcUrl,
  });

  await ensureDeterministicFactory({
    chainId,
    chainName: profile.chainName,
    connection,
    factoryAddress: VENUE_STACK_DEPLOYMENT.deterministicFactoryAddress,
    publicClient,
  });
  const transferApprovalDeployed = await hasBytecode(
    publicClient,
    VENUE_STACK_DEPLOYMENT.transferApprovalAddress,
  );
  if (!transferApprovalDeployed) {
    if (chainId !== LOCAL_DEVCHAIN_CHAIN_ID) {
      throw new Error(
        `Transfer-approval singleton has no bytecode at ${VENUE_STACK_DEPLOYMENT.transferApprovalAddress} ` +
          `on ${profile.chainName}. The venue stack expects it before maker flows go live.`,
      );
    }
    console.log(
      "Local devchain has no transfer-approval singleton; recording it as optional in the manifest.",
    );
  }

  if (chainId === LOCAL_DEVCHAIN_CHAIN_ID) {
    // Local devchains restart from an empty state, so stale Ignition journals
    // from earlier runs must not be reconciled against the fresh chain.
    await rm(config.ignitionDeploymentDir, { force: true, recursive: true });
  }

  const deployedContracts = (await connection.ignition.deploy(VenueStackModule, {
    defaultSender: deployerAddress,
    deploymentId: config.deploymentId,
    displayUi: true,
  })) as Record<string, { address: Address }>;

  const contractSpecs: string[] = [];
  for (const descriptor of VENUE_STACK_DEPLOYMENT.contracts) {
    const deployedContract = deployedContracts[descriptor.resultKey];
    if (deployedContract === undefined) {
      throw new Error(`Ignition result missing ${descriptor.resultKey}.`);
    }
    if (!(await hasBytecode(publicClient, deployedContract.address))) {
      throw new Error(
        `${descriptor.contractName} has no deployed bytecode at ${deployedContract.address}.`,
      );
    }

    console.log(`${descriptor.contractName}: ${deployedContract.address}`);
    contractSpecs.push(`${descriptor.manifestKey}=${deployedContract.address}`);
  }

  const blockNumber = Number(await publicClient.getBlockNumber());
  const transferApprovalSpec = `transferApproval=${VENUE_STACK_DEPLOYMENT.transferApprovalAddress}`;
  await writeVenueManifest({
    blockNumber,
    chainId,
    deployer: deployerAddress,
    env: process.env,
    optionalContracts: transferApprovalDeployed
      ? []
      : [{ required: false, spec: transferApprovalSpec }],
    outputFile: config.deploymentFile,
    protocolRoot: hre.config.paths.root,
    requiredContracts: [
      ...contractSpecs.map((spec) => ({ required: true, spec })),
      {
        required: true,
        spec: `deterministicFactory=${VENUE_STACK_DEPLOYMENT.deterministicFactoryAddress}`,
      },
      ...(transferApprovalDeployed ? [{ required: true, spec: transferApprovalSpec }] : []),
    ],
    rpcUrl: config.rpcUrl,
  });

  if (config.shouldVerify) {
    await verifyIgnitionDeployment({
      deploymentId: config.deploymentId,
      tasks,
    });
    console.log(`Verified Ignition deployment ${config.deploymentId} on the configured explorer.`);
  }
}

await main();

/**
 * Reads operator settings and resolves repo-local output paths for one chain.
 */
function loadConfig(env: NodeJS.ProcessEnv, profile: DeploymentChainProfile) {
  const deploymentId =
    env.POPCHARTS_IGNITION_DEPLOYMENT_ID ||
    `${VENUE_STACK_DEPLOYMENT.deploymentIdPrefix}-${profile.chainEnv}`;

  return {
    deploymentFile: resolveDeploymentManifestFile(VENUE_STACK_DEPLOYMENT, {
      chainEnv: profile.chainEnv,
      env,
      protocolRoot: hre.config.paths.root,
    }),
    deploymentId,
    ignitionDeploymentDir: resolve(hre.config.paths.ignition, "deployments", deploymentId),
    rpcUrl: env.POPCHARTS_RPC_URL || profile.defaultRpcUrl,
    shouldVerify:
      profile.supportsExplorerVerification && env.POPCHARTS_VERIFY_CONTRACTS !== "false",
  };
}
