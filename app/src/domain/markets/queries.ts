import {
  createIndexerMarketsApiClient,
  type IndexedMarketLookup,
  type IndexerFetch,
  type IndexerMarketsApiClient,
  type ListIndexedMarketsParams,
} from "@/integrations/indexer/markets-api";

import { markets as fixtureMarkets } from "./fixtures";
import { indexedMarketToMarket, parseIndexedMarketAppId } from "./indexed-market";

export type MarketDataSource = "auto" | "api" | "fixtures";

export type MarketQueryOptions = {
  apiBaseUrl?: string;
  chainId?: number;
  client?: IndexerMarketsApiClient;
  fetcher?: IndexerFetch;
  since?: string;
  source?: MarketDataSource;
};

export async function getMarketById(id: string, options: MarketQueryOptions = {}) {
  const config = resolveMarketQueryConfig(options);

  if (config.useApi) {
    const lookup = resolveMarketLookup(id, config.chainId);

    if (lookup) {
      const indexedMarket = await config.client.getMarket(lookup);

      if (indexedMarket) {
        return indexedMarketToMarket(indexedMarket);
      }

      if (config.source === "api") {
        return undefined;
      }
    } else if (config.source === "api") {
      return undefined;
    }
  }

  return fixtureMarkets.find((market) => market.id === id);
}

export async function getMarkets(options: MarketQueryOptions = {}) {
  const config = resolveMarketQueryConfig(options);

  if (!config.useApi) {
    return fixtureMarkets;
  }

  const params: ListIndexedMarketsParams = {};

  if (config.chainId !== undefined) {
    params.chainId = config.chainId;
  }

  if (options.since) {
    params.since = options.since;
  }

  const indexedMarkets = await config.client.getMarkets(params);

  return indexedMarkets.map(indexedMarketToMarket);
}

function resolveMarketLookup(
  id: string,
  chainId: number | undefined
): IndexedMarketLookup | null {
  const parsed = parseIndexedMarketAppId(id);

  if (parsed) {
    return parsed;
  }

  if (chainId === undefined) {
    return null;
  }

  return { chainId, marketId: id };
}

function resolveMarketQueryConfig(options: MarketQueryOptions) {
  const source = options.source ?? readMarketDataSource();
  const chainId = options.chainId ?? readMarketChainId();

  if (source === "fixtures") {
    return chainId === undefined
      ? { source, useApi: false as const }
      : { chainId, source, useApi: false as const };
  }

  if (options.client) {
    return chainId === undefined
      ? { client: options.client, source, useApi: true as const }
      : { chainId, client: options.client, source, useApi: true as const };
  }

  const apiBaseUrl = options.apiBaseUrl ?? readIndexerApiBaseUrl();

  if (!apiBaseUrl) {
    if (source === "api") {
      throw new Error(
        "POPCHARTS_INDEXER_API_URL is required when POPCHARTS_MARKET_DATA_SOURCE=api."
      );
    }

    return chainId === undefined
      ? { source, useApi: false as const }
      : { chainId, source, useApi: false as const };
  }

  const client = options.fetcher
    ? createIndexerMarketsApiClient({
        baseUrl: apiBaseUrl,
        fetcher: options.fetcher,
      })
    : createIndexerMarketsApiClient({ baseUrl: apiBaseUrl });

  return chainId === undefined
    ? { client, source, useApi: true as const }
    : { chainId, client, source, useApi: true as const };
}

function readIndexerApiBaseUrl() {
  return (
    process.env.POPCHARTS_INDEXER_API_URL ??
    process.env.NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL
  );
}

function readMarketChainId() {
  const value =
    process.env.POPCHARTS_MARKETS_CHAIN_ID ??
    process.env.NEXT_PUBLIC_POPCHARTS_MARKETS_CHAIN_ID;

  if (!value) {
    return undefined;
  }

  const chainId = Number.parseInt(value, 10);

  if (Number.isNaN(chainId)) {
    throw new Error(`Invalid POPCHARTS_MARKETS_CHAIN_ID: ${value}`);
  }

  return chainId;
}

function readMarketDataSource(): MarketDataSource {
  const value = process.env.POPCHARTS_MARKET_DATA_SOURCE;

  if (!value) {
    return "auto";
  }

  if (value === "auto" || value === "api" || value === "fixtures") {
    return value;
  }

  throw new Error(`Invalid POPCHARTS_MARKET_DATA_SOURCE: ${value}`);
}
