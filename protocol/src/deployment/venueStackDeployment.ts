// Type-only viem import keeps this module dependency-free at runtime:
// repo-root strip-types scripts import it by relative path and cannot follow
// runtime imports with ".js"-suffixed relative specifiers.
import type { Address } from "viem";

/**
 * Shared identifiers for the self-deployed v4 venue-stack Ignition deployment,
 * including the manifest file every venue reader and writer must agree on.
 *
 * `transferApproval` is the canonical allowance-transfer singleton (Permit2)
 * and `deterministicFactory` is the keyless CREATE2 factory; both are deployed
 * at the same address on Arc Testnet and most EVM chains.
 */
export const VENUE_STACK_DEPLOYMENT = {
  contracts: [
    {
      contractName: "PoolManager",
      futureId: "VenueStack#PoolManager",
      manifestKey: "poolManager",
      resultKey: "poolManager",
    },
    {
      contractName: "StateView",
      futureId: "VenueStack#StateView",
      manifestKey: "stateView",
      resultKey: "stateView",
    },
    {
      contractName: "V4Quoter",
      futureId: "VenueStack#V4Quoter",
      manifestKey: "quoter",
      resultKey: "quoter",
    },
    {
      contractName: "MinimalV4SwapRouter",
      futureId: "VenueStack#MinimalV4SwapRouter",
      manifestKey: "swapRouter",
      resultKey: "swapRouter",
    },
  ],
  defaultDeploymentFile: (chainEnv: string): string =>
    `deployments/${chainEnv}.venue-stack.local.json`,
  deployHint:
    "Run the venue-stack deploy first (pnpm local:deploy-venue or pnpm arc:testnet:deploy-venue).",
  deploymentFileEnvVar: "POPCHARTS_VENUE_DEPLOYMENT_FILE",
  deploymentIdPrefix: "venue-stack",
  deterministicFactoryAddress: "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address,
  transferApprovalAddress: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
} as const;
