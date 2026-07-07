import {
  createPublicClient,
  createWalletClient as createViemWalletClient,
  fallback,
  http,
  webSocket,
  type Account,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";

import { config } from "src/config";

export type BlockchainClient = PublicClient<Transport, Chain>;

export type BlockchainWalletClient = WalletClient<Transport, Chain, Account>;

/**
 * Long-lived public client for the indexer: WSS transport for event
 * subscriptions, with an HTTP fallback derived from the WSS endpoint when no
 * explicit HTTP URL is configured.
 */
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

/**
 * Read-only public client over plain HTTP, for API services and runners that
 * only need request/response reads (no event subscriptions).
 */
export function createReadOnlyClient(): BlockchainClient {
  return createPublicClient({
    chain: config.chain,
    transport: http(config.rpcHttpUrl),
  });
}

/**
 * Wallet client over plain HTTP for server-initiated transactions, bound to
 * the given account and the configured chain.
 */
export function createWalletClient(account: Account): BlockchainWalletClient {
  return createViemWalletClient({
    account,
    chain: config.chain,
    transport: http(config.rpcHttpUrl),
  });
}
