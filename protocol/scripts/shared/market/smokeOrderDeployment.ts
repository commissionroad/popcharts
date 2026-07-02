/**
 * Shared identifiers for the smoke maker-order manifest so the maker-order
 * flow that writes it and the taker-swap flow that consumes it resolve the
 * same file for one chain.
 */
export const SMOKE_ORDER_DEPLOYMENT = {
  defaultDeploymentFile: (chainEnv: string): string =>
    `deployments/${chainEnv}.smoke-maker-order.local.json`,
} as const;
