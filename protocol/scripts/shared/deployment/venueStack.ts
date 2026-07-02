import type { Address } from "viem";

/**
 * Shared identifiers for the self-deployed v4 venue-stack Ignition deployment.
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
  deploymentIdPrefix: "venue-stack",
  deterministicFactoryAddress: "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address,
  transferApprovalAddress: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
} as const;
