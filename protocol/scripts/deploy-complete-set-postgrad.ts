import { relative, resolve } from "node:path";

import hre, { network } from "hardhat";
import { type Address, type Hex, type PublicClient } from "viem";

import { assertNativeBalance } from "./shared/account/assertNativeBalance.js";
import type { DeploymentChainProfile } from "./shared/chain/resolveDeploymentChainProfile.js";
import { initializeWalletScriptEnvironment } from "./shared/cli/initializeScriptEnvironment.js";
import { requireAddress, requireNonNegativeInteger } from "../src/cli/requireCliValue.js";
import { assertDeployedBytecode } from "./shared/contract/assertDeployedBytecode.js";
import { ARC_PROTOCOL_DEPLOYMENT } from "./shared/deployment/arcProtocol.js";
import { deployCompleteSetPostgradContracts } from "./shared/deployment/deployCompleteSetPostgrad.js";
import { hasBytecode } from "./shared/deployment/deterministicFactory.js";
import { readManifestAddresses } from "./shared/deployment/readManifestAddresses.js";
import { resolveDeploymentManifestFile } from "./shared/deployment/resolveDeploymentManifestFile.js";
import {
  formatVenueContractEntry,
  normalizeVenueContractEntries,
  type VenueManifestContractEntry,
} from "./shared/deployment/venueManifest.js";
import { POSTGRAD_VENUE_DEPLOYMENT } from "../src/deployment/postgradVenueDeployment.js";
import { VENUE_STACK_DEPLOYMENT } from "../src/deployment/venueStackDeployment.js";
import { writeJsonFile } from "../src/json/jsonFile.js";
import { printDeploymentHeader } from "./shared/log/printDeploymentHeader.js";

// Complete-set outcome tokens default to 18 decimals, matching the local v4
// stack smoke and the whitepaper's WAD-scaled outcome accounting.
const DEFAULT_OUTCOME_DECIMALS = 18;

type PostgradVenueManifest = {
  readonly blockNumber: string;
  readonly chainId: number;
  readonly contracts: Record<string, VenueManifestContractEntry>;
  readonly deployer: Address;
  readonly generatedAt: string;
  readonly hookSalt: Hex;
  readonly rpcUrl: string;
};

/**
 * Deploys the complete-set postgrad venue contracts against a previously
 * deployed v4 venue stack: PoolTickBounds, BoundedPoolOrderManager, the
 * CREATE2-mined BoundedPredictionHook, and CompleteSetPostgradAdapter.
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
    contractName: "Pop Charts complete-set postgrad venue",
    currencyDecimals: profile.nativeCurrency.decimals,
    currencySymbol: profile.nativeCurrency.symbol,
    deployerAddress,
    rpcUrl: config.rpcUrl,
  });

  // The postgrad venue is meaningless without the v4 stack, so fail with a
  // pointer to the venue deploy instead of broadcasting partial state.
  const venueAddresses = await readManifestAddresses({
    deployHint: VENUE_STACK_DEPLOYMENT.deployHint,
    expectedChainId: chainId,
    kind: "venue",
    manifestFile: config.venueDeploymentFile,
    names: ["deterministicFactory", "poolManager", "transferApproval"],
    protocolRoot: hre.config.paths.root,
  });
  await assertDeployedBytecode(publicClient, "poolManager", venueAddresses.poolManager);
  await assertDeployedBytecode(
    publicClient,
    "deterministicFactory",
    venueAddresses.deterministicFactory,
  );
  const pregradManagerAddress = await resolvePregradManagerAddress({
    chainId,
    env: process.env,
    protocolRoot: hre.config.paths.root,
    publicClient,
  });
  const resolverAddress = config.resolverAddress ?? deployerAddress;

  const {
    boundedHookAddress,
    hookSalt,
    orderManagerAddress,
    poolTickBoundsAddress,
    postgradAdapterAddress,
  } = await deployCompleteSetPostgradContracts({
    connection,
    deployerAddress,
    deterministicFactory: venueAddresses.deterministicFactory,
    outcomeDecimals: config.outcomeDecimals,
    poolManager: venueAddresses.poolManager,
    pregradManagerAddress,
    resolverAddress,
    transferApproval: venueAddresses.transferApproval,
    walletClient,
  });

  const blockNumber = await publicClient.getBlockNumber();
  const transferApprovalDeployed = await hasBytecode(publicClient, venueAddresses.transferApproval);
  const contracts = normalizeVenueContractEntries([
    { required: true, spec: `poolTickBounds=${poolTickBoundsAddress}` },
    { required: true, spec: `orderManager=${orderManagerAddress}` },
    { required: true, spec: `boundedHook=${boundedHookAddress}` },
    { required: true, spec: `postgradAdapter=${postgradAdapterAddress}` },
    { required: true, spec: `pregradManager=${pregradManagerAddress}` },
    { required: true, spec: `poolManager=${venueAddresses.poolManager}` },
    { required: true, spec: `deterministicFactory=${venueAddresses.deterministicFactory}` },
    {
      required: transferApprovalDeployed,
      spec: `transferApproval=${venueAddresses.transferApproval}`,
    },
  ]);
  const manifest: PostgradVenueManifest = {
    blockNumber: blockNumber.toString(),
    chainId,
    contracts: Object.fromEntries(
      contracts.map((contract) => [contract.name, formatVenueContractEntry(contract)]),
    ),
    deployer: deployerAddress,
    generatedAt: new Date().toISOString(),
    hookSalt,
    rpcUrl: config.rpcUrl,
  };
  await writeJsonFile(config.deploymentFile, manifest);

  const outputPath = relative(hre.config.paths.root, config.deploymentFile);
  console.log(`Wrote ${outputPath}`);
  console.log(`Verify with: pnpm deployment:check-venue --manifest ${outputPath}`);
}

await main();

/**
 * Reads operator settings and resolves repo-local manifest paths for one chain.
 */
function loadConfig(env: NodeJS.ProcessEnv, profile: DeploymentChainProfile) {
  return {
    deploymentFile: resolveDeploymentManifestFile(POSTGRAD_VENUE_DEPLOYMENT, {
      chainEnv: profile.chainEnv,
      env,
      protocolRoot: hre.config.paths.root,
    }),
    outcomeDecimals: requireNonNegativeInteger(
      env.POPCHARTS_OUTCOME_DECIMALS ?? DEFAULT_OUTCOME_DECIMALS,
      "POPCHARTS_OUTCOME_DECIMALS",
    ),
    resolverAddress:
      env.POPCHARTS_POSTGRAD_RESOLVER === undefined
        ? undefined
        : requireAddress(env.POPCHARTS_POSTGRAD_RESOLVER, "POPCHARTS_POSTGRAD_RESOLVER"),
    rpcUrl: env.POPCHARTS_RPC_URL || profile.defaultRpcUrl,
    venueDeploymentFile: resolveDeploymentManifestFile(VENUE_STACK_DEPLOYMENT, {
      chainEnv: profile.chainEnv,
      env,
      protocolRoot: hre.config.paths.root,
    }),
  };
}

// The adapter binds to one pregrad manager forever, so resolve it from an
// explicit env var or a protocol manifest and never guess.
async function resolvePregradManagerAddress({
  chainId,
  env,
  protocolRoot,
  publicClient,
}: {
  chainId: number;
  env: NodeJS.ProcessEnv;
  protocolRoot: string;
  publicClient: PublicClient;
}): Promise<Address> {
  let pregradManagerAddress: Address;
  if (env.POPCHARTS_PREGRAD_MANAGER_ADDRESS !== undefined) {
    pregradManagerAddress = requireAddress(
      env.POPCHARTS_PREGRAD_MANAGER_ADDRESS,
      "POPCHARTS_PREGRAD_MANAGER_ADDRESS",
    );
  } else {
    ({ pregradManager: pregradManagerAddress } = await readManifestAddresses({
      deployHint: "Set POPCHARTS_PREGRAD_MANAGER_ADDRESS or provide a protocol manifest.",
      expectedChainId: chainId,
      kind: "protocol",
      manifestFile: resolve(
        protocolRoot,
        env[ARC_PROTOCOL_DEPLOYMENT.deploymentFileEnvVar] ||
          ARC_PROTOCOL_DEPLOYMENT.defaultDeploymentFile,
      ),
      mismatchHint: "Set POPCHARTS_PREGRAD_MANAGER_ADDRESS instead.",
      names: ["pregradManager"],
      protocolRoot,
    }));
  }

  await assertDeployedBytecode(publicClient, "pregradManager", pregradManagerAddress);
  return pregradManagerAddress;
}
