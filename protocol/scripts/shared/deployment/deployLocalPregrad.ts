import type { network } from "hardhat";
import { describeLocalDevChainIds, isLocalDevChainId } from "../chain/localDevChainIds.js";
import type { Address } from "viem";

import { getWalletClientAddress } from "../account/getWalletClientAddress.js";
import { localDisputeConfigArgs } from "./localDisputeConfig.js";
import { deployPregradManager } from "./deployPregradManager.js";

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
  reviewCreditVaultAddress: Address;
};

/**
 * Deploys the smallest useful protocol surface for local development:
 * collateral for market config, the singleton manager whose MarketCreated
 * event the indexer watches, a postgrad adapter so dev tooling can finalize
 * graduations end to end, and the review-bond vault (ADR 0022) with the
 * deployer standing in as both owner and settlement resolver.
 */
export async function deployLocalPregrad(viem: LocalNetworkViem): Promise<DeploySummary> {
  const publicClient = await viem.getPublicClient();
  // This seam stamps the zero dispute config and dev-only trust wiring, so it
  // must never reach a real chain — no escape hatch. Real networks deploy the
  // adapter through deploy-complete-set-postgrad with explicit dispute config.
  const chainId = await publicClient.getChainId();
  if (!isLocalDevChainId(chainId)) {
    throw new Error(
      `deployLocalPregrad is local-only (expected chain ${describeLocalDevChainIds()}, ` +
        `connected to ${chainId}). Use deploy-complete-set-postgrad for real networks.`,
    );
  }
  const [walletClient] = await viem.getWalletClients();
  const deployerAddress = getWalletClientAddress({
    missingMessage: "Expected the local development network to expose a deployer account.",
    walletClient,
  });

  const collateral = await viem.deployContract("MockCollateral");
  const manager = await deployPregradManager(viem);
  const postgradAdapter = await viem.deployContract("CompleteSetPostgradAdapter", [
    manager.address,
    deployerAddress,
    deployerAddress,
    OUTCOME_DECIMALS,
    ...localDisputeConfigArgs(),
  ]);
  const reviewCreditVault = await viem.deployContract("ReviewCreditVault", [deployerAddress]);

  // Arm the creation gate (repo ADR 0022 P4): the deployer account doubles as
  // the local market-creation authorizer, matching the server's local default
  // signing key (hardhat account #0), so publish authorizations minted by the
  // API verify against this deployment out of the box. Production deploys set
  // a dedicated authorizer key instead.
  await manager.write.setMarketCreationAuthorizer([deployerAddress]);

  // The deployer is also a trusted creator: protocol-workspace tooling (boot
  // seeding, smoke lanes, tests) creates markets with a zeroed authorization
  // now that the ungated path is gone (repo ADR 0022 P5). The product path
  // never uses this — the app publishes with a real server-minted signature.
  await manager.write.setTrustedCreator([deployerAddress, true]);

  // The indexer starts at this block for non-local networks. We still emit it
  // for local smoke so env generation mirrors real deployment metadata.
  const deployBlock = await publicClient.getBlockNumber();

  return {
    chainId,
    collateralAddress: collateral.address,
    deployBlock: deployBlock.toString(),
    postgradAdapterAddress: postgradAdapter.address,
    pregradManagerAddress: manager.address,
    reviewCreditVaultAddress: reviewCreditVault.address,
  };
}
