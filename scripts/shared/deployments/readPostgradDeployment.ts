import { resolve } from "node:path";

import { readJsonFile } from "../json/readJsonFile.ts";
import { protocolDir } from "../paths.ts";

/** Addresses and pool ids of a locally deployed postgrad venue and demo market. */
export type PostgradDeployment = {
  readonly boundedHook: string;
  readonly marketAddress: string;
  readonly marketSymbol: string;
  readonly noPoolId: string;
  readonly noTokenAddress: string;
  readonly orderManager: string;
  readonly poolManager: string;
  readonly poolTickBounds: string;
  readonly postgradAdapter: string;
  readonly quoter: string;
  readonly stateView: string;
  readonly swapRouter: string;
  readonly yesPoolId: string;
  readonly yesTokenAddress: string;
};

type ContractsManifest = {
  contracts: Record<string, { address: string }>;
};

type MarketManifest = {
  market: {
    address: string;
    noToken: string;
    symbol: string;
    yesToken: string;
  };
  pools: {
    no: { poolId: string };
    yes: { poolId: string };
  };
};

/**
 * Reads the postgrad venue, v4 venue stack, and market manifests the protocol
 * deploy scripts write under `protocol/deployments/`. Manifests are the
 * machine-readable record of what was deployed; reading them beats scraping
 * addresses from Hardhat stdout.
 */
export function readPostgradDeployment(
  marketSymbol: string,
): PostgradDeployment {
  const venue = readJsonFile<ContractsManifest>(
    resolve(protocolDir, "deployments", "local.venue-stack.local.json"),
  ).contracts;
  const postgradContracts = readJsonFile<ContractsManifest>(
    resolve(protocolDir, "deployments", "local.postgrad.local.json"),
  ).contracts;
  const market = readJsonFile<MarketManifest>(
    resolve(
      protocolDir,
      "deployments",
      `local.market-${marketSymbol.toLowerCase()}.local.json`,
    ),
  );

  return {
    boundedHook: postgradContracts.boundedHook.address,
    marketAddress: market.market.address,
    marketSymbol: market.market.symbol,
    noPoolId: market.pools.no.poolId,
    noTokenAddress: market.market.noToken,
    orderManager: postgradContracts.orderManager.address,
    poolManager: venue.poolManager.address,
    poolTickBounds: postgradContracts.poolTickBounds.address,
    postgradAdapter: postgradContracts.postgradAdapter.address,
    quoter: venue.quoter.address,
    stateView: venue.stateView.address,
    swapRouter: venue.swapRouter.address,
    yesPoolId: market.pools.yes.poolId,
    yesTokenAddress: market.market.yesToken,
  };
}
