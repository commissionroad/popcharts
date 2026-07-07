import type { network } from "hardhat";
import type { Address } from "viem";

type LocalNetworkViem = Awaited<ReturnType<typeof network.create>>["viem"];

// This summary is the contract between the Hardhat deploy helper and the root
// local-dev orchestrators, which parse it back from a LOCAL_CHAIN_SMOKE_DEPLOY
// stdout line to configure server/indexer env vars for the exact deployment.
export type DeploySummary = {
  chainId: number;
  collateralAddress: Address;
  deployBlock: string;
  pregradManagerAddress: Address;
};

/**
 * Deploys the smallest useful protocol surface for local development:
 * collateral for market config and the singleton manager whose MarketCreated
 * event the indexer watches.
 */
export async function deployLocalPregrad(viem: LocalNetworkViem): Promise<DeploySummary> {
  const publicClient = await viem.getPublicClient();
  const collateral = await viem.deployContract("MockCollateral");
  const manager = await viem.deployContract("PregradManager");

  // The indexer starts at this block for non-local networks. We still emit it
  // for local smoke so env generation mirrors real deployment metadata.
  const deployBlock = await publicClient.getBlockNumber();

  return {
    chainId: await publicClient.getChainId(),
    collateralAddress: collateral.address,
    deployBlock: deployBlock.toString(),
    pregradManagerAddress: manager.address,
  };
}
