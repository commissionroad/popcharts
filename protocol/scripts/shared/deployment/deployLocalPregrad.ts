import type { network } from "hardhat";
import type { Address } from "viem";

import { getWalletClientAddress } from "../account/getWalletClientAddress.js";
import { localDisputeConfigArgs } from "./localDisputeConfig.js";

type LocalNetworkViem = Awaited<ReturnType<typeof network.create>>["viem"];

// Complete-set outcome tokens default to 18 decimals, matching the WAD-scaled
// pregrad accounting.
const OUTCOME_DECIMALS = 18;

// This summary is the contract between the Hardhat deploy helper and the root
// local-dev orchestrators, which parse it back from a LOCAL_CHAIN_SMOKE_DEPLOY
// stdout line to configure server/indexer env vars for the exact deployment.
export type DeploySummary = {
  chainId: number;
  collateralAddress: Address;
  deployBlock: string;
  postgradAdapterAddress: Address;
  pregradManagerAddress: Address;
};

/**
 * Deploys the smallest useful protocol surface for local development:
 * collateral for market config, the singleton manager whose MarketCreated
 * event the indexer watches, and a postgrad adapter so dev tooling can
 * finalize graduations end to end.
 */
export async function deployLocalPregrad(viem: LocalNetworkViem): Promise<DeploySummary> {
  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();
  const deployerAddress = getWalletClientAddress({
    missingMessage: "Expected the local Hardhat network to expose a deployer account.",
    walletClient,
  });

  const collateral = await viem.deployContract("MockCollateral");
  const manager = await viem.deployContract("PregradManager");
  const postgradAdapter = await viem.deployContract("CompleteSetPostgradAdapter", [
    manager.address,
    deployerAddress,
    deployerAddress,
    OUTCOME_DECIMALS,
    ...localDisputeConfigArgs(),
  ]);

  // The indexer starts at this block for non-local networks. We still emit it
  // for local smoke so env generation mirrors real deployment metadata.
  const deployBlock = await publicClient.getBlockNumber();

  return {
    chainId: await publicClient.getChainId(),
    collateralAddress: collateral.address,
    deployBlock: deployBlock.toString(),
    postgradAdapterAddress: postgradAdapter.address,
    pregradManagerAddress: manager.address,
  };
}
