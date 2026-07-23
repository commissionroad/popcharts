import { DEFAULT_HARDHAT_PRIVATE_KEY } from "../chain/defaultHardhatPrivateKey.ts";
import type { PregradDeploy } from "../deployments/pregradDeploy.ts";
import type { PostgradDeployment } from "../deployments/readPostgradDeployment.ts";
import { postgradAppEnv } from "./postgradEnv.ts";

/**
 * The Next.js app's generated env block for a local chain deployment: real
 * chain reads, devchain-relay market creation, local wallet + dev tools
 * enabled, market data from the local API. Shared by the local-dev
 * orchestrators and the lifecycle e2e runner so the app always boots against
 * a local stack with one canonical configuration.
 */
export function buildLocalAppEnv(args: {
  apiBaseUrl: string;
  deploy: PregradDeploy;
  postgrad: PostgradDeployment | null;
  rpcHttpUrl: string;
}): Record<string, string> {
  const { apiBaseUrl, deploy, postgrad, rpcHttpUrl } = args;

  return {
    NEXT_PUBLIC_POPCHARTS_CHAIN_ENV: "local",
    NEXT_PUBLIC_POPCHARTS_MARKET_CREATION_MODE: "devchain",
    NEXT_PUBLIC_POPCHARTS_MARKET_CREATION_SIGNER: "wallet",
    NEXT_PUBLIC_POPCHARTS_CHAIN_ID: String(deploy.chainId),
    NEXT_PUBLIC_POPCHARTS_RPC_URL: rpcHttpUrl,
    NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS: deploy.pregradManagerAddress,
    NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS: deploy.collateralAddress,
    NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN: "true",
    NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_WALLET: "true",
    NEXT_PUBLIC_POPCHARTS_DEV_TOOLS_ENABLED: "true",
    POPCHARTS_DEVCHAIN_ENABLED: "true",
    POPCHARTS_DEVCHAIN_PRIVATE_KEY:
      process.env.POPCHARTS_DEVCHAIN_PRIVATE_KEY ??
      DEFAULT_HARDHAT_PRIVATE_KEY,
    POPCHARTS_INDEXER_API_URL: apiBaseUrl,
    POPCHARTS_MARKET_DATA_SOURCE: "api",
    POPCHARTS_MARKETS_CHAIN_ID: String(deploy.chainId),
    ...postgradAppEnv(postgrad),
  };
}
