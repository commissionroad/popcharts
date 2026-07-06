import { getNetworkConfig, ZERO_ADDRESS } from "./networks";

/**
 * The server's resolved runtime configuration: the selected network's chain,
 * RPC, and contract settings plus server-level flags. Feature flags like
 * adminReviewEnabled and devToolsEnabled default to off — dangerous endpoints
 * must be enabled explicitly per environment.
 */
export const config = {
  ...getNetworkConfig(),
  adminReviewEnabled: process.env.POPCHARTS_ADMIN_REVIEW_ENABLED === "true",
  apiPort: Number.parseInt(process.env.PORT ?? "3001", 10),
  devToolsEnabled: process.env.POPCHARTS_DEV_TOOLS_ENABLED === "true",
  healthCheckFile:
    process.env.HEALTH_CHECK_FILE ?? "/tmp/popcharts-indexer-healthy",
  /**
   * Basis points of a graduated market's retained collateral used to size
   * each leg of the dev backstop liquidity seeded per outcome pool at
   * graduation. 0 disables seeding.
   */
  venueSeedBps: Number.parseInt(
    process.env.POPCHARTS_VENUE_SEED_BPS ?? "1000",
    10,
  ),
};

/**
 * Fails fast at indexer startup when the websocket RPC URL or PregradManager
 * address is missing, instead of letting watchers spin up against nothing.
 */
export function validateIndexerConfig() {
  if (!config.rpcWssUrl) {
    throw new Error("RPC_WSS_URL is required for event indexing.");
  }

  if (
    !config.contracts.pregradManager ||
    config.contracts.pregradManager === ZERO_ADDRESS
  ) {
    throw new Error("PREGRAD_MANAGER_ADDRESS is required for event indexing.");
  }
}

export {
  chainIdToNetwork,
  getNetworkConfig,
  getNetworkId,
  ZERO_ADDRESS,
} from "./networks";
export type { ContractAddresses, NetworkConfig, NetworkId } from "./networks";
