import { marketFileSlug } from "./marketFileSlug.js";

/**
 * Shared identifiers for complete-set market manifests so the market creation
 * script and the smoke flows resolve the same manifest file for one market
 * symbol on one chain.
 */
export const COMPLETE_SET_MARKET_DEPLOYMENT = {
  defaultDeploymentFile: (chainEnv: string, marketSymbol: string): string =>
    `deployments/${chainEnv}.market-${marketFileSlug(marketSymbol)}.local.json`,
  defaultMarketSymbol: "PCSM",
} as const;
