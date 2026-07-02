import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import hre, { network, tasks } from "hardhat";
import type { Address, Hex, PublicClient } from "viem";

import VenueStackModule from "../ignition/modules/VenueStack.js";
import { assertNativeBalance } from "./shared/account/assertNativeBalance.js";
import { getWalletClientAddress } from "./shared/account/getWalletClientAddress.js";
import {
  resolveDeploymentChainProfile,
  type DeploymentChainProfile,
} from "./shared/chain/resolveDeploymentChainProfile.js";
import { VENUE_STACK_DEPLOYMENT } from "./shared/deployment/venueStack.js";
import { assertHardhatNetwork } from "./shared/hardhat/assertHardhatNetwork.js";
import { verifyIgnitionDeployment } from "./shared/ignition/verifyIgnitionDeployment.js";
import { printDeploymentHeader } from "./shared/log/printDeploymentHeader.js";
import { writeVenueManifest } from "./write-venue-manifest.js";

// Runtime bytecode of the keyless CREATE2 factory expected at
// VENUE_STACK_DEPLOYMENT.deterministicFactoryAddress. Source: Arachnid's
// deterministic-deployment-proxy, read back from the canonical mainnet deploy.
const DETERMINISTIC_FACTORY_RUNTIME_BYTECODE: Hex =
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

const LOCAL_DEVCHAIN_CHAIN_ID = 31_337;

/**
 * Deploys the self-hosted v4 venue stack (PoolManager, StateView, V4Quoter,
 * MinimalV4SwapRouter) through Hardhat Ignition and writes the venue manifest
 * consumed by `pnpm deployment:check-venue`.
 */
async function main() {
  const connection = await network.create();
  const profile = resolveDeploymentChainProfile(connection.networkName);
  const config = loadConfig(process.env, profile);
  const publicClient = await connection.viem.getPublicClient();
  const [walletClient] = await connection.viem.getWalletClients();
  const deployerAddress = getWalletClientAddress({
    missingMessage:
      `Expected Hardhat network ${profile.networkName} to expose a deployer account. ` +
      "Set POPCHARTS_DEPLOYER_PRIVATE_KEY.",
    walletClient,
  });
  const chainId = await assertHardhatNetwork({
    expectedChainId: profile.chainId,
    expectedNetworkName: profile.networkName,
    networkName: connection.networkName,
    publicClient,
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

  await ensureDeterministicFactory({ chainId, connection, publicClient });
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

type VenueStackDeployConnection = {
  viem: {
    getTestClient(): Promise<{
      setCode(parameters: { address: Address; bytecode: Hex }): Promise<void>;
    }>;
  };
};

/**
 * Reads operator settings and resolves repo-local output paths for one chain.
 */
function loadConfig(env: NodeJS.ProcessEnv, profile: DeploymentChainProfile) {
  const deploymentId =
    env.POPCHARTS_IGNITION_DEPLOYMENT_ID ||
    `${VENUE_STACK_DEPLOYMENT.deploymentIdPrefix}-${profile.chainEnv}`;

  return {
    deploymentFile: resolve(
      hre.config.paths.root,
      env.POPCHARTS_VENUE_DEPLOYMENT_FILE ||
        VENUE_STACK_DEPLOYMENT.defaultDeploymentFile(profile.chainEnv),
    ),
    deploymentId,
    ignitionDeploymentDir: resolve(hre.config.paths.ignition, "deployments", deploymentId),
    rpcUrl: env.POPCHARTS_RPC_URL || profile.defaultRpcUrl,
    shouldVerify:
      profile.supportsExplorerVerification && env.POPCHARTS_VERIFY_CONTRACTS !== "false",
  };
}

// The postgrad hook deploy needs the keyless CREATE2 factory. Real chains must
// already have it; the throwaway local devchain is seeded in place instead.
async function ensureDeterministicFactory({
  chainId,
  connection,
  publicClient,
}: {
  chainId: number;
  connection: VenueStackDeployConnection;
  publicClient: PublicClient;
}): Promise<void> {
  const factoryAddress = VENUE_STACK_DEPLOYMENT.deterministicFactoryAddress;
  if (await hasBytecode(publicClient, factoryAddress)) {
    return;
  }
  if (chainId !== LOCAL_DEVCHAIN_CHAIN_ID) {
    throw new Error(
      `Deterministic CREATE2 factory has no bytecode at ${factoryAddress}. ` +
        "Deploy or locate the keyless factory before deploying the venue stack.",
    );
  }

  const testClient = await connection.viem.getTestClient();
  await testClient.setCode({
    address: factoryAddress,
    bytecode: DETERMINISTIC_FACTORY_RUNTIME_BYTECODE,
  });
  if (!(await hasBytecode(publicClient, factoryAddress))) {
    throw new Error(`Failed to seed the deterministic CREATE2 factory at ${factoryAddress}.`);
  }
  console.log(`Seeded local deterministic CREATE2 factory at ${factoryAddress}.`);
}

async function hasBytecode(publicClient: PublicClient, address: Address): Promise<boolean> {
  const bytecode = await publicClient.getCode({ address });
  return bytecode !== undefined && bytecode !== "0x";
}
