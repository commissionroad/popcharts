import hre from "hardhat";
import type { network } from "hardhat";
import { concatHex, encodeDeployData, getAddress, type Address, type Hex } from "viem";

import { mineHookSalt } from "../contract/mineHookSalt.js";
import { hasBytecode } from "./deterministicFactory.js";
import { ensureTokenPullerBytecode } from "./tokenPuller.js";
import {
  assertDeployableDisputeConfig,
  type ZeroDisputeConfigToken,
} from "./resolveDisputeConfig.js";

// Exact hook permission bits BoundedPredictionHook.hookPermissionFlags()
// requires its deployment address to encode: beforeSwap (1 << 7) and
// afterSwap (1 << 6) per the v4-core Hooks.sol flag bit layout.
export const BOUNDED_HOOK_PERMISSION_FLAGS = (1n << 7n) | (1n << 6n);

type LocalNetworkConnection = Awaited<ReturnType<typeof network.create>>;

type HookDeployWalletClient = {
  sendTransaction(parameters: { data: Hex; to: Address }): Promise<Hex>;
};

export type PostgradVenueContracts = {
  boundedHookAddress: Address;
  hookSalt: Hex;
  orderManagerAddress: Address;
  poolTickBoundsAddress: Address;
  postgradAdapterAddress: Address;
};

export type DeployCompleteSetPostgradArgs = {
  // Zero-config deploys on a real chain must carry the literal token, so a
  // hard-coded bypass reads as the admission it is (resolveDisputeConfig.ts).
  allowZeroDisputeConfig?: ZeroDisputeConfigToken;
  connection: Pick<LocalNetworkConnection, "viem">;
  deployerAddress: Address;
  deterministicFactory: Address;
  disputeBond: bigint;
  disputeWindow: bigint;
  outcomeDecimals: number;
  poolManager: Address;
  pregradManagerAddress: Address;
  resolverAddress: Address;
  transferApproval: Address;
  walletClient: HookDeployWalletClient;
};

/**
 * Deploys the complete-set postgrad venue contracts against a previously
 * deployed v4 venue stack: PoolTickBounds, BoundedPoolOrderManager, the
 * CREATE2-mined BoundedPredictionHook, and CompleteSetPostgradAdapter. This is
 * the one seam where the deploy scripts construct and wire the postgrad
 * contracts, so protocol-side changes to their constructors, hook permission
 * flags, or role wiring surface here first.
 */
export async function deployCompleteSetPostgradContracts(
  args: DeployCompleteSetPostgradArgs,
): Promise<PostgradVenueContracts> {
  const { connection, deployerAddress, walletClient } = args;
  const publicClient = await connection.viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  // Nothing touches the chain before this guard: a caller that hardcodes zero
  // dispute config dies here on any real network (repo ADR 0024).
  assertDeployableDisputeConfig({
    allowZeroDisputeConfig: args.allowZeroDisputeConfig,
    chainId,
    disputeBond: args.disputeBond,
    disputeWindow: args.disputeWindow,
  });
  const tokenPullerMode = await ensureTokenPullerBytecode({
    chainId,
    connection,
    publicClient,
    tokenPuller: args.transferApproval,
  });
  console.log(`Order-manager token puller ready at ${args.transferApproval} (${tokenPullerMode}).`);

  const poolTickBounds = await connection.viem.deployContract("PoolTickBounds", [deployerAddress]);
  const poolTickBoundsAddress = getAddress(poolTickBounds.address);
  console.log(`PoolTickBounds: ${poolTickBoundsAddress}`);

  const orderManager = await connection.viem.deployContract("BoundedPoolOrderManager", [
    args.poolManager,
    args.transferApproval,
    deployerAddress,
  ]);
  const orderManagerAddress = getAddress(orderManager.address);
  console.log(`BoundedPoolOrderManager: ${orderManagerAddress}`);

  const hookArtifact = await hre.artifacts.readArtifact("BoundedPredictionHook");
  const hookInitCode = encodeDeployData({
    abi: hookArtifact.abi,
    args: [args.poolManager, poolTickBoundsAddress, orderManagerAddress],
    bytecode: hookArtifact.bytecode as Hex,
  });
  const { hookAddress, salt } = mineHookSalt({
    deterministicFactory: args.deterministicFactory,
    initCode: hookInitCode,
    requiredFlags: BOUNDED_HOOK_PERMISSION_FLAGS,
  });
  console.log(`Mined hook salt ${salt} for BoundedPredictionHook at ${hookAddress}`);

  // The keyless factory expects calldata of salt ++ init code and performs the
  // CREATE2 deployment at the pre-computed, flag-encoding address.
  const hookDeployHash = await walletClient.sendTransaction({
    data: concatHex([salt, hookInitCode]),
    to: args.deterministicFactory,
  });
  await publicClient.waitForTransactionReceipt({ hash: hookDeployHash });
  if (!(await hasBytecode(publicClient, hookAddress))) {
    throw new Error(`boundedHook has no deployed bytecode at ${hookAddress}.`);
  }

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
    args.pregradManagerAddress,
    deployerAddress,
    args.resolverAddress,
    args.outcomeDecimals,
    args.disputeWindow,
    args.disputeBond,
  ]);
  const postgradAdapterAddress = getAddress(postgradAdapter.address);

  // Read the stamped config back so a regression that drops the constructor
  // threading (or swaps the argument order) fails the deploy, not a market.
  const deployedDisputeWindow = (await postgradAdapter.read.disputeWindow()) as bigint;
  const deployedDisputeBond = (await postgradAdapter.read.disputeBond()) as bigint;
  if (deployedDisputeWindow !== args.disputeWindow || deployedDisputeBond !== args.disputeBond) {
    throw new Error(
      `CompleteSetPostgradAdapter reports dispute config (window=${deployedDisputeWindow}s, ` +
        `bond=${deployedDisputeBond} raw), expected (window=${args.disputeWindow}s, ` +
        `bond=${args.disputeBond} raw).`,
    );
  }
  console.log(`CompleteSetPostgradAdapter: ${postgradAdapterAddress}`);
  console.log(
    `Dispute config stamped: window ${deployedDisputeWindow}s, bond ${deployedDisputeBond} raw`,
  );

  return {
    boundedHookAddress: hookAddress,
    hookSalt: salt,
    orderManagerAddress,
    poolTickBoundsAddress,
    postgradAdapterAddress,
  };
}
