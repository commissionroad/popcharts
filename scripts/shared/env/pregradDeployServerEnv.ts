import { type PregradDeploy } from "../deployments/pregradDeploy.ts";

/**
 * The ONE place a pregrad deploy's fields become server env vars.
 *
 * This mapping used to be hand-copied across five orchestrator sites (the
 * shared server-env builder, the smoke's private builder, both generated
 * env-file writers, and the per-orchestrator override objects). A field
 * missing from any one copy typechecked and was dropped silently — which is
 * how the review-credit vault address reached four of the five and left the
 * lifecycle lane running unmetered. Every consumer now derives from this
 * record; when `PregradDeploy` grows a field, add its env var here and every
 * builder and env file picks it up.
 *
 * Absent fields map to the blank values the pre-deploy boot relies on (the
 * orchestrators start services before the deploy completes, with the same
 * env shape and empty addresses).
 */
export function pregradDeployServerEnv(
  overrides: Partial<Omit<PregradDeploy, "chainId">> = {},
): Record<string, string> {
  return {
    PREGRAD_MANAGER_ADDRESS: overrides.pregradManagerAddress ?? "",
    PREGRAD_MANAGER_DEPLOY_BLOCK: overrides.deployBlock ?? "0",
    LOCAL_PREGRAD_MANAGER_ADDRESS: overrides.pregradManagerAddress ?? "",
    LOCAL_PREGRAD_MANAGER_DEPLOY_BLOCK: overrides.deployBlock ?? "0",
    LOCAL_COLLATERAL_ADDRESS: overrides.collateralAddress ?? "",
    LOCAL_POSTGRAD_ADAPTER_ADDRESS: overrides.postgradAdapterAddress ?? "",
    LOCAL_REVIEW_BOND_VAULT_ADDRESS: overrides.reviewBondVaultAddress ?? "",
  };
}

/**
 * The same mapping as env-file lines, for the generated `.env.local-chain.*`
 * files. Blank values are omitted rather than written as empty assignments:
 * the file is only ever written after a completed deploy, and downstream
 * readers (`run-lifecycle-e2e.ts`) fail loudly on a *missing* key but would
 * misread an empty one as configured.
 */
export function pregradDeployServerEnvLines(deploy: PregradDeploy): string[] {
  return Object.entries(pregradDeployServerEnv(deploy))
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}=${value}`);
}
