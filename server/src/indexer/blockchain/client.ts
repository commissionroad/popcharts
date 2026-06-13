import {
  createPublicClient,
  fallback,
  http,
  webSocket,
  type Chain,
  type PublicClient,
  type Transport,
} from "viem";

import { config } from "src/config";

export type BlockchainClient = PublicClient<Transport, Chain>;

export function createBlockchainClient(): BlockchainClient {
  const httpUrl =
    config.rpcHttpUrl ||
    config.rpcWssUrl.replace("wss://", "https://").replace("ws://", "http://");

  return createPublicClient({
    chain: config.chain,
    transport: fallback([
      webSocket(config.rpcWssUrl, {
        reconnect: {
          attempts: 10,
          delay: 1000,
        },
      }),
      http(httpUrl),
    ]),
  });
}
