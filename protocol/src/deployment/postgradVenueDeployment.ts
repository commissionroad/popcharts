// Keep this module dependency-free: repo-root strip-types scripts import it
// by relative path and cannot follow ".js"-suffixed relative imports.

/**
 * Shared identifiers for the complete-set postgrad venue deployment manifest,
 * so the postgrad deploy script (the writer) and every operator script that
 * resolves postgrad venue addresses agree on one manifest file per chain.
 */
export const POSTGRAD_VENUE_DEPLOYMENT = {
  defaultDeploymentFile: (chainEnv: string): string =>
    `deployments/${chainEnv}.postgrad.local.json`,
  deployHint:
    "Run the postgrad deploy first (pnpm local:deploy-postgrad or pnpm arc:testnet:deploy-postgrad).",
  deploymentFileEnvVar: "POPCHARTS_POSTGRAD_DEPLOYMENT_FILE",
} as const;
