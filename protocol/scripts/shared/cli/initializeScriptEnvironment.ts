import type { network as hardhatNetworkManager } from "hardhat";
import type { Address } from "viem";

import { getWalletClientAddress } from "../account/getWalletClientAddress.js";
import {
  resolveDeploymentChainProfile,
  type DeploymentChainProfile,
} from "../chain/resolveDeploymentChainProfile.js";
import { assertHardhatNetwork } from "../hardhat/assertHardhatNetwork.js";

// Type-only view of Hardhat's network manager so this shared module stays free
// of runtime hardhat imports (scripts pass in the `network` they already have).
type HardhatNetworkManager = typeof hardhatNetworkManager;
type ScriptNetworkConnection = Awaited<ReturnType<HardhatNetworkManager["create"]>>;
type ScriptPublicClient = Awaited<ReturnType<ScriptNetworkConnection["viem"]["getPublicClient"]>>;
type ScriptWalletClient = Awaited<
  ReturnType<ScriptNetworkConnection["viem"]["getWalletClients"]>
>[number];

export type ReadOnlyScriptEnvironment = {
  chainId: number;
  connection: ScriptNetworkConnection;
  profile: DeploymentChainProfile;
  publicClient: ScriptPublicClient;
};

export type WalletScriptEnvironment<Config = undefined> = ReadOnlyScriptEnvironment & {
  account: Address;
  config: Config;
  walletClient: ScriptWalletClient;
};

/**
 * Builds the error message scripts print when the Hardhat network exposes no
 * account, keeping the exact wording each script used before the preamble was
 * bundled here (only the role word — deployer/keeper/smoke — varied).
 */
export function formatMissingAccountMessage({
  accountRole,
  networkName,
}: {
  accountRole: string;
  networkName: string;
}): string {
  return (
    `Expected Hardhat network ${networkName} to expose a ${accountRole} account. ` +
    "Set POPCHARTS_DEPLOYER_PRIVATE_KEY."
  );
}

/**
 * Shared preamble for read-only scripts (health checks, inspections): creates
 * the network connection, resolves the deployment chain profile, builds the
 * public client, and asserts Hardhat selected the expected network and chain.
 */
export async function initializeReadOnlyScriptEnvironment({
  network,
}: {
  network: HardhatNetworkManager;
}): Promise<ReadOnlyScriptEnvironment> {
  const connection = await network.create();
  const profile = resolveDeploymentChainProfile(connection.networkName);
  const publicClient = await connection.viem.getPublicClient();
  const chainId = await assertHardhatNetwork({
    expectedChainId: profile.chainId,
    expectedNetworkName: profile.networkName,
    networkName: connection.networkName,
    publicClient,
  });
  return { chainId, connection, profile, publicClient };
}

/**
 * Shared preamble for scripts that send transactions (deploys, smokes, the
 * keeper): the read-only preamble plus the first wallet client and its
 * checksummed account address, failing with the script's role-specific message
 * when the network exposes no account. `loadConfig` runs between profile
 * resolution and client creation so per-script env-config errors keep their
 * original position ahead of any wallet or chain checks.
 */
export async function initializeWalletScriptEnvironment<Config = undefined>({
  accountRole,
  loadConfig,
  network,
}: {
  accountRole: string;
  loadConfig?: (profile: DeploymentChainProfile) => Config;
  network: HardhatNetworkManager;
}): Promise<WalletScriptEnvironment<Config>> {
  const connection = await network.create();
  const profile = resolveDeploymentChainProfile(connection.networkName);
  const config = (loadConfig === undefined ? undefined : loadConfig(profile)) as Config;
  const publicClient = await connection.viem.getPublicClient();
  const [walletClient] = await connection.viem.getWalletClients();
  const missingMessage = formatMissingAccountMessage({
    accountRole,
    networkName: profile.networkName,
  });
  if (walletClient === undefined) {
    throw new Error(missingMessage);
  }
  const account = getWalletClientAddress({ missingMessage, walletClient });
  const chainId = await assertHardhatNetwork({
    expectedChainId: profile.chainId,
    expectedNetworkName: profile.networkName,
    networkName: connection.networkName,
    publicClient,
  });
  return { account, chainId, config, connection, profile, publicClient, walletClient };
}
