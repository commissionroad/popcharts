import { localAiReviewBaseUrl } from "../aiReview/localAiReviewEndpoint.ts";
import { localAiReviewRunnerPollMs } from "../aiReview/localAiReviewRunnerPollMs.ts";
import { DEFAULT_HARDHAT_PRIVATE_KEY } from "../chain/defaultHardhatPrivateKey.ts";
import { type PregradDeploy } from "../deployments/pregradDeploy.ts";
import { localDevIndexerHealthFile } from "./localDevEnvFiles.ts";

/**
 * Environment for the local Bun API and indexer, shared by the local-dev and
 * local-dev-control orchestrators: Hardhat RPC on 127.0.0.1:8545, the
 * docker-compose Postgres (DATABASE_URL override honored), the API port from
 * LOCAL_API_PORT, dev tooling flags, and the local AI review wiring. Before
 * deployment the address overrides are blank so db:push can run with the
 * same DATABASE_URL; after deployment they carry the fresh chain addresses.
 */
export function buildLocalServerEnv(
  overrides: Partial<Omit<PregradDeploy, "chainId">> = {},
): NodeJS.ProcessEnv {
  return {
    AI_REVIEW_SERVICE_URL: localAiReviewBaseUrl,
    AI_REVIEW_RUNNER_POLL_MS: localAiReviewRunnerPollMs(),
    DATABASE_URL:
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5433/popcharts",
    HEALTH_CHECK_FILE: localDevIndexerHealthFile,
    LOCAL_COLLATERAL_ADDRESS: overrides.collateralAddress ?? "",
    LOCAL_PREGRAD_MANAGER_ADDRESS: overrides.pregradManagerAddress ?? "",
    LOCAL_PREGRAD_MANAGER_DEPLOY_BLOCK: overrides.deployBlock ?? "0",
    NETWORK: "local",
    PORT: process.env.LOCAL_API_PORT ?? "3001",
    POPCHARTS_ADMIN_REVIEW_ENABLED: "true",
    POPCHARTS_DEVCHAIN_PRIVATE_KEY:
      process.env.POPCHARTS_DEVCHAIN_PRIVATE_KEY ?? DEFAULT_HARDHAT_PRIVATE_KEY,
    POPCHARTS_DEV_TOOLS_ENABLED: "true",
    PREGRAD_MANAGER_ADDRESS: overrides.pregradManagerAddress ?? "",
    PREGRAD_MANAGER_DEPLOY_BLOCK: overrides.deployBlock ?? "0",
    RPC_HTTP_URL: "http://127.0.0.1:8545",
    RPC_WSS_URL: "ws://127.0.0.1:8545",
  };
}
