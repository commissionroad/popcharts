import { sharedLocalReviewModelEnv } from "../aiReview/buildAiReviewEnv.ts";
import { localAiReviewBaseUrl } from "../aiReview/localAiReviewEndpoint.ts";
import { DEFAULT_HARDHAT_PRIVATE_KEY as DEFAULT_LOCAL_CHAIN_PRIVATE_KEY } from "../chain/defaultHardhatPrivateKey.ts";
import { type PregradDeploy } from "../deployments/pregradDeploy.ts";
import type { StackPorts } from "../localStack/ports.ts";

import { pregradDeployServerEnv } from "./pregradDeployServerEnv.ts";

/**
 * Environment for the local Bun API and indexer, shared by the local-dev and
 * control-plane orchestrators. RPC URLs, default API port, Postgres database,
 * review endpoint, and indexer health marker come from one slot resource set;
 * explicit DATABASE_URL and LOCAL_API_PORT overrides remain honored.
 * Deployment address overrides are blank before deployment and populated
 * after it completes.
 *
 * The API also hosts the in-process draft-review loop, so this builder is
 * the stack seam that opts local drafts into the real model gate. Deployed
 * environments never run this builder; they leave
 * POPCHARTS_DRAFT_REVIEW_PROVIDER unset, so the in-code heuristic default
 * (server/src/draft-review/runner.ts) governs there.
 */
export function buildLocalServerEnv(
  resources: StackPorts,
  overrides: Partial<Omit<PregradDeploy, "chainId">> = {},
): NodeJS.ProcessEnv {
  return {
    AI_REVIEW_SERVICE_URL: localAiReviewBaseUrl(resources),
    // The draft loop reads the shared AI_REVIEW_* config; without these the
    // API would fall back to the deployed evidence defaults (precollected +
    // tavily) and spend every draft review on no-key evidence collection.
    ...sharedLocalReviewModelEnv(),
    DATABASE_URL:
      process.env.DATABASE_URL ??
      `postgresql://postgres:postgres@localhost:5433/${resources.dbName}`,
    HEALTH_CHECK_FILE: resources.indexerHealthFilePath,
    ...pregradDeployServerEnv(overrides),
    NETWORK: "local",
    PORT: process.env.LOCAL_API_PORT ?? String(resources.apiPort),
    POPCHARTS_DEVCHAIN_PRIVATE_KEY:
      process.env.POPCHARTS_DEVCHAIN_PRIVATE_KEY ??
      DEFAULT_LOCAL_CHAIN_PRIVATE_KEY,
    POPCHARTS_DEV_TOOLS_ENABLED: "true",
    // LOCAL_DRAFT_REVIEW_PROVIDER dials the draft gate alone;
    // LOCAL_AI_REVIEW_PROVIDER dials the whole stack, so one variable makes
    // every local review deterministic.
    POPCHARTS_DRAFT_REVIEW_PROVIDER:
      process.env.LOCAL_DRAFT_REVIEW_PROVIDER ??
      process.env.LOCAL_AI_REVIEW_PROVIDER ??
      "claude-cli",
    RPC_HTTP_URL: resources.chainRpcHttpUrl,
    RPC_WSS_URL: resources.chainRpcWssUrl,
  };
}
