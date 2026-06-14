import { getNetworkConfig, ZERO_ADDRESS } from "./networks";

export const config = {
  ...getNetworkConfig(),
  apiPort: Number.parseInt(process.env.PORT ?? "3001", 10),
  healthCheckFile:
    process.env.HEALTH_CHECK_FILE ?? "/tmp/popcharts-indexer-healthy",
};

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
