import { relative, resolve } from "node:path";

import hre, { network } from "hardhat";
import {
  concatHex,
  encodeAbiParameters,
  getAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { assertNativeBalance } from "./shared/account/assertNativeBalance.mjs";
import { getWalletClientAddress } from "./shared/account/getWalletClientAddress.js";
import {
  resolveDeploymentChainProfile,
  type DeploymentChainProfile,
} from "./shared/chain/resolveDeploymentChainProfile.js";
import { requireAddress, requireNonNegativeInteger } from "./shared/cli/requireCliValue.js";
import { mineHookSalt } from "./shared/contract/mineHookSalt.js";
import { ARC_PROTOCOL_DEPLOYMENT } from "./shared/deployment/arcProtocol.mjs";
import {
  collectVenueAddressEntries,
  formatVenueContractEntry,
  normalizeVenueContractEntries,
  type VenueManifestContractEntry,
} from "./shared/deployment/venueManifest.js";
import { VENUE_STACK_DEPLOYMENT } from "./shared/deployment/venueStack.js";
import { assertHardhatNetwork } from "./shared/hardhat/assertHardhatNetwork.js";
import { readJsonFile, writeJsonFile } from "./shared/json/jsonFile.js";
import { printDeploymentHeader } from "./shared/log/printDeploymentHeader.mjs";

// Exact hook permission bits BoundedPredictionHook.hookPermissionFlags()
// requires its deployment address to encode: beforeSwap (1 << 7) and
// afterSwap (1 << 6) per the v4-core Hooks.sol flag bit layout.
const BOUNDED_HOOK_PERMISSION_FLAGS = (1n << 7n) | (1n << 6n);

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
    contractName: "Pop Charts complete-set postgrad venue",
    currencyDecimals: profile.nativeCurrency.decimals,
    currencySymbol: profile.nativeCurrency.symbol,
    deployerAddress,
    rpcUrl: config.rpcUrl,
  });

  const venueAddresses = await readVenueStackAddresses({
    chainId,
    protocolRoot: hre.config.paths.root,
    venueDeploymentFile: config.venueDeploymentFile,
  });
  await assertBytecode(publicClient, "poolManager", venueAddresses.poolManager);
  await assertBytecode(publicClient, "deterministicFactory", venueAddresses.deterministicFactory);
  const pregradManagerAddress = await resolvePregradManagerAddress({
    chainId,
    env: process.env,
    protocolRoot: hre.config.paths.root,
    publicClient,
  });
  const resolverAddress = config.resolverAddress ?? deployerAddress;

  const poolTickBounds = await connection.viem.deployContract("PoolTickBounds", [deployerAddress]);
  const poolTickBoundsAddress = getAddress(poolTickBounds.address);
  console.log(`PoolTickBounds: ${poolTickBoundsAddress}`);

  const orderManager = await connection.viem.deployContract("BoundedPoolOrderManager", [
    venueAddresses.poolManager,
    venueAddresses.transferApproval,
    deployerAddress,
  ]);
  const orderManagerAddress = getAddress(orderManager.address);
  console.log(`BoundedPoolOrderManager: ${orderManagerAddress}`);

  const hookArtifact = await hre.artifacts.readArtifact("BoundedPredictionHook");
  const hookInitCode = concatHex([
    hookArtifact.bytecode as Hex,
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address" }],
      [venueAddresses.poolManager, poolTickBoundsAddress, orderManagerAddress],
    ),
  ]);
  const { hookAddress, salt } = mineHookSalt({
    deterministicFactory: venueAddresses.deterministicFactory,
    initCode: hookInitCode,
    requiredFlags: BOUNDED_HOOK_PERMISSION_FLAGS,
  });
  console.log(`Mined hook salt ${salt} for BoundedPredictionHook at ${hookAddress}`);

  // The keyless factory expects calldata of salt ++ init code and performs the
  // CREATE2 deployment at the pre-computed, flag-encoding address.
  const hookDeployHash = await walletClient.sendTransaction({
    data: concatHex([salt, hookInitCode]),
    to: venueAddresses.deterministicFactory,
  });
  await publicClient.waitForTransactionReceipt({ hash: hookDeployHash });
  await assertBytecode(publicClient, "boundedHook", hookAddress);

  const hook = await connection.viem.getContractAt("BoundedPredictionHook", hookAddress);
  const deployedFlags = (await hook.read.hookPermissionFlags()) as bigint;
  if (deployedFlags !== BOUNDED_HOOK_PERMISSION_FLAGS) {
    throw new Error(
      `BoundedPredictionHook reports permission flags ${deployedFlags}, ` +
        `expected ${BOUNDED_HOOK_PERMISSION_FLAGS}.`,
    );
  }
  console.log(`BoundedPredictionHook: ${hookAddress}`);

  // The hook may only push crossed-order execution into the order manager once
  // the owner grants it the hook role.
  const hookRoleHash = await orderManager.write.setHookRole([hookAddress, true]);
  await publicClient.waitForTransactionReceipt({ hash: hookRoleHash });
  if ((await orderManager.read.hookRole([hookAddress])) !== true) {
    throw new Error(`Order manager did not record the hook role for ${hookAddress}.`);
  }
  console.log(`Granted order-manager hook role to ${hookAddress}`);

  const postgradAdapter = await connection.viem.deployContract("CompleteSetPostgradAdapter", [
    pregradManagerAddress,
    deployerAddress,
    resolverAddress,
    config.outcomeDecimals,
  ]);
  const postgradAdapterAddress = getAddress(postgradAdapter.address);
  console.log(`CompleteSetPostgradAdapter: ${postgradAdapterAddress}`);

  const blockNumber = await publicClient.getBlockNumber();
  const transferApprovalDeployed = await hasBytecode(publicClient, venueAddresses.transferApproval);
  const contracts = normalizeVenueContractEntries([
    { required: true, spec: `poolTickBounds=${poolTickBoundsAddress}` },
    { required: true, spec: `orderManager=${orderManagerAddress}` },
    { required: true, spec: `boundedHook=${hookAddress}` },
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
    hookSalt: salt,
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
    deploymentFile: resolve(
      hre.config.paths.root,
      env.POPCHARTS_POSTGRAD_DEPLOYMENT_FILE ||
        `deployments/${profile.chainEnv}.postgrad.local.json`,
    ),
    outcomeDecimals: requireNonNegativeInteger(
      env.POPCHARTS_OUTCOME_DECIMALS ?? DEFAULT_OUTCOME_DECIMALS,
      "POPCHARTS_OUTCOME_DECIMALS",
    ),
    resolverAddress:
      env.POPCHARTS_POSTGRAD_RESOLVER === undefined
        ? undefined
        : requireAddress(env.POPCHARTS_POSTGRAD_RESOLVER, "POPCHARTS_POSTGRAD_RESOLVER"),
    rpcUrl: env.POPCHARTS_RPC_URL || profile.defaultRpcUrl,
    venueDeploymentFile: resolve(
      hre.config.paths.root,
      env.POPCHARTS_VENUE_DEPLOYMENT_FILE ||
        VENUE_STACK_DEPLOYMENT.defaultDeploymentFile(profile.chainEnv),
    ),
  };
}

// The postgrad venue is meaningless without the v4 stack, so fail with a
// pointer to the venue deploy instead of broadcasting partial state.
async function readVenueStackAddresses({
  chainId,
  protocolRoot,
  venueDeploymentFile,
}: {
  chainId: number;
  protocolRoot: string;
  venueDeploymentFile: string;
}): Promise<{
  deterministicFactory: Address;
  poolManager: Address;
  transferApproval: Address;
}> {
  const manifestPath = relative(protocolRoot, venueDeploymentFile);
  let manifest: unknown;
  try {
    manifest = await readJsonFile(venueDeploymentFile);
  } catch {
    throw new Error(
      `Could not read venue manifest ${manifestPath}. Run the venue-stack deploy first ` +
        "(pnpm local:deploy-venue or pnpm arc:testnet:deploy-venue).",
    );
  }

  const manifestChainId = readManifestField(manifest, "chainId");
  if (manifestChainId !== chainId) {
    throw new Error(
      `Venue manifest ${manifestPath} is for chain ${String(manifestChainId)}, ` +
        `but the connected chain is ${chainId}.`,
    );
  }

  const entries = collectVenueAddressEntries(manifest);
  return {
    deterministicFactory: requireManifestAddress(entries, "deterministicFactory", manifestPath),
    poolManager: requireManifestAddress(entries, "poolManager", manifestPath),
    transferApproval: requireManifestAddress(entries, "transferApproval", manifestPath),
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
  let pregradManagerAddress: Address | undefined;
  if (env.POPCHARTS_PREGRAD_MANAGER_ADDRESS !== undefined) {
    pregradManagerAddress = requireAddress(
      env.POPCHARTS_PREGRAD_MANAGER_ADDRESS,
      "POPCHARTS_PREGRAD_MANAGER_ADDRESS",
    );
  } else {
    const protocolDeploymentFile = resolve(
      protocolRoot,
      env.POPCHARTS_PROTOCOL_DEPLOYMENT_FILE || ARC_PROTOCOL_DEPLOYMENT.defaultDeploymentFile,
    );
    let manifest: unknown;
    try {
      manifest = await readJsonFile(protocolDeploymentFile);
    } catch {
      throw new Error(
        "No pregrad manager configured. Set POPCHARTS_PREGRAD_MANAGER_ADDRESS or provide a " +
          `protocol manifest at ${relative(protocolRoot, protocolDeploymentFile)}.`,
      );
    }

    const manifestChainId = readManifestField(manifest, "chainId");
    if (manifestChainId !== chainId) {
      throw new Error(
        `Protocol manifest ${relative(protocolRoot, protocolDeploymentFile)} is for chain ` +
          `${String(manifestChainId)}, but the connected chain is ${chainId}. ` +
          "Set POPCHARTS_PREGRAD_MANAGER_ADDRESS instead.",
      );
    }
    pregradManagerAddress = requireManifestAddress(
      collectVenueAddressEntries(manifest),
      "pregradManager",
      relative(protocolRoot, protocolDeploymentFile),
    );
  }

  await assertBytecode(publicClient, "pregradManager", pregradManagerAddress);
  return pregradManagerAddress;
}

function requireManifestAddress(
  entries: readonly { address: Address; name: string }[],
  name: string,
  manifestPath: string,
): Address {
  const entry = entries.find((candidate) => candidate.name === name);
  if (entry === undefined) {
    throw new Error(`Manifest ${manifestPath} has no ${name} address entry.`);
  }
  return entry.address;
}

function readManifestField(manifest: unknown, field: string): unknown {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return undefined;
  }
  return (manifest as Record<string, unknown>)[field];
}

async function assertBytecode(
  publicClient: PublicClient,
  name: string,
  address: Address,
): Promise<void> {
  if (!(await hasBytecode(publicClient, address))) {
    throw new Error(`${name} has no deployed bytecode at ${address}.`);
  }
}

async function hasBytecode(publicClient: PublicClient, address: Address): Promise<boolean> {
  const bytecode = await publicClient.getCode({ address });
  return bytecode !== undefined && bytecode !== "0x";
}
