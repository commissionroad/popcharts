import { basename, resolve } from "node:path";

// Cross-workspace imports by relative path: these scripts run under
// node --experimental-strip-types, which cannot resolve the protocol
// package's exports map or the ".js"-suffixed relative imports its modules
// use internally — so only dependency-free leaf modules are importable here.
import { POSTGRAD_VENUE_DEPLOYMENT } from "../../../protocol/src/deployment/postgradVenueDeployment.ts";
import { VENUE_STACK_DEPLOYMENT } from "../../../protocol/src/deployment/venueStackDeployment.ts";
import { COMPLETE_SET_MARKET_DEPLOYMENT } from "../../../protocol/src/market/completeSetMarketDeployment.ts";
import { readJsonFile } from "../json/readJsonFile.ts";
import { protocolDir } from "../paths.ts";

// The local-dev stack always targets the "local" chain env of the protocol
// deploy scripts.
const LOCAL_CHAIN_ENV = "local";

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

// The protocol constants name manifests relative to the protocol root
// ("deployments/<file>"); this reader resolves within an injectable
// deployments directory (tests point it at fixtures), so it keeps only the
// filename.
function manifestFileName(protocolRelativePath: string): string {
  return basename(protocolRelativePath);
}

/**
 * Reads the postgrad venue, v4 venue stack, and market manifests the protocol
 * deploy scripts write under `protocol/deployments/`. Manifests are the
 * machine-readable record of what was deployed; reading them beats scraping
 * addresses from Hardhat stdout.
 */
export function readPostgradDeployment(
  marketSymbol: string,
  deploymentsDir: string = resolve(protocolDir, "deployments"),
): PostgradDeployment {
  const venue = readJsonFile<ContractsManifest>(
    resolve(
      deploymentsDir,
      manifestFileName(VENUE_STACK_DEPLOYMENT.defaultDeploymentFile(LOCAL_CHAIN_ENV)),
    ),
  ).contracts;
  const postgradContracts = readJsonFile<ContractsManifest>(
    resolve(
      deploymentsDir,
      manifestFileName(POSTGRAD_VENUE_DEPLOYMENT.defaultDeploymentFile(LOCAL_CHAIN_ENV)),
    ),
  ).contracts;
  const market = readJsonFile<MarketManifest>(
    resolve(
      deploymentsDir,
      manifestFileName(
        COMPLETE_SET_MARKET_DEPLOYMENT.defaultDeploymentFile(LOCAL_CHAIN_ENV, marketSymbol),
      ),
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
