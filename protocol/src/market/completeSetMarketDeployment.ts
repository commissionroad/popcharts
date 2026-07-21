// Keep this module dependency-free (marketFileSlug lives in-file rather than
// as its own helper): repo-root strip-types scripts import it by relative
// path, and node --experimental-strip-types cannot follow the ".js"-suffixed
// relative imports src modules use internally.

/**
 * Normalizes an operator-supplied market symbol into a safe manifest filename
 * slug, so market manifest paths never carry unexpected path characters.
 */
export function marketFileSlug(marketSymbol: string): string {
  const slug = marketSymbol
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "market";
}

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
