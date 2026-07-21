import { localAiReviewBaseUrl } from "../aiReview/localAiReviewEndpoint.ts";
import { localAiReviewRunnerPollMs } from "../aiReview/localAiReviewRunnerPollMs.ts";
import { DEFAULT_HARDHAT_PRIVATE_KEY as DEFAULT_LOCAL_CHAIN_PRIVATE_KEY } from "../chain/defaultHardhatPrivateKey.ts";
import { type PregradDeploy } from "../deployments/pregradDeploy.ts";
import type { StackPorts } from "../localStack/ports.ts";

/**
 * Environment for the local Bun API and indexer, shared by the local-dev and
 * control-plane orchestrators. RPC URLs, default API port, Postgres database,
 * review endpoint, and indexer health marker come from one slot resource set;
 * explicit DATABASE_URL and LOCAL_API_PORT overrides remain honored.
 * Deployment address overrides are blank before deployment and populated
 * after it completes.
 */
export function buildLocalServerEnv(
  resources: StackPorts,
  overrides: Partial<Omit<PregradDeploy, "chainId">> = {},
): NodeJS.ProcessEnv {
  return {
    AI_REVIEW_SERVICE_URL: localAiReviewBaseUrl(resources),
    AI_REVIEW_RUNNER_POLL_MS: localAiReviewRunnerPollMs(),
    DATABASE_URL:
      process.env.DATABASE_URL ??
      `postgresql://postgres:postgres@localhost:5433/${resources.dbName}`,
    HEALTH_CHECK_FILE: resources.indexerHealthFilePath,
    LOCAL_COLLATERAL_ADDRESS: overrides.collateralAddress ?? "",
    LOCAL_POSTGRAD_ADAPTER_ADDRESS: overrides.postgradAdapterAddress ?? "",
    LOCAL_PREGRAD_MANAGER_ADDRESS: overrides.pregradManagerAddress ?? "",
    LOCAL_PREGRAD_MANAGER_DEPLOY_BLOCK: overrides.deployBlock ?? "0",
    NETWORK: "local",
    PORT: process.env.LOCAL_API_PORT ?? String(resources.apiPort),
    POPCHARTS_ADMIN_REVIEW_ENABLED: "true",
    POPCHARTS_DEVCHAIN_PRIVATE_KEY:
      process.env.POPCHARTS_DEVCHAIN_PRIVATE_KEY ??
      DEFAULT_LOCAL_CHAIN_PRIVATE_KEY,
    POPCHARTS_DEV_TOOLS_ENABLED: "true",
    PREGRAD_MANAGER_ADDRESS: overrides.pregradManagerAddress ?? "",
    PREGRAD_MANAGER_DEPLOY_BLOCK: overrides.deployBlock ?? "0",
    RPC_HTTP_URL: resources.chainRpcHttpUrl,
    RPC_WSS_URL: resources.chainRpcWssUrl,
  };
}
