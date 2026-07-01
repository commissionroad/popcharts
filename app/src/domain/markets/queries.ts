import {
  createMarketsApiClient,
  type ListMarketsParams,
  type MarketApiLookup,
  type MarketsApiClient,
  type MarketsApiFetch,
} from "@/integrations/indexer/markets-api";

import { apiMarketToMarket, parseApiMarketAppId } from "./api-market";
import { markets as fixtureMarkets } from "./fixtures";

export type MarketDataSource = "auto" | "api" | "fixtures";

export type MarketQueryOptions = {
  apiBaseUrl?: string;
  chainId?: number;
  client?: MarketsApiClient;
  fetcher?: MarketsApiFetch;
  since?: string;
  source?: MarketDataSource;
};

export async function getMarketById(id: string, options: MarketQueryOptions = {}) {
  const config = resolveMarketQueryConfig(options);

  if (config.useApi) {
    const lookup = resolveMarketLookup(id, config.chainId);

    if (lookup) {
      const apiMarket = await config.client.getMarket(lookup);

      if (apiMarket) {
        return apiMarketToMarket(apiMarket);
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

  const params: ListMarketsParams = {};

  if (config.chainId !== undefined) {
    params.chainId = config.chainId.toString();
  }

  if (options.since) {
    params.since = options.since;
  }

  const apiMarkets = await config.client.getMarkets(params);

  return apiMarkets.map(apiMarketToMarket);
}

export async function requestMarketGraduation(
  id: string,
  options: MarketQueryOptions = {}
) {
  const config = resolveMarketQueryConfig(options);

  if (!config.useApi) {
    throw new Error("Market graduation requires API-backed market data.");
  }

  const lookup = resolveMarketLookup(id, config.chainId);

  if (!lookup) {
    throw new Error("Market graduation requires a chain-prefixed market id.");
  }

  return config.client.graduateMarket(lookup);
}

export async function requestPregradMarketCloseForRefund(
  id: string,
  options: MarketQueryOptions = {}
) {
  const config = resolveMarketQueryConfig(options);

  if (!config.useApi) {
    throw new Error("Dev market close requires API-backed market data.");
  }

  const lookup = resolveMarketLookup(id, config.chainId);

  if (!lookup) {
    throw new Error("Dev market close requires a chain-prefixed market id.");
  }

  return config.client.closePregradMarket(lookup);
}

function resolveMarketLookup(
  id: string,
  chainId: number | undefined
): MarketApiLookup | null {
  const parsed = parseApiMarketAppId(id);

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

  const apiBaseUrl = options.apiBaseUrl ?? readMarketApiBaseUrl();

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
    ? createMarketsApiClient({
        baseUrl: apiBaseUrl,
        fetcher: options.fetcher,
      })
    : createMarketsApiClient({ baseUrl: apiBaseUrl });

  return chainId === undefined
    ? { client, source, useApi: true as const }
    : { chainId, client, source, useApi: true as const };
}

function readMarketApiBaseUrl() {
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
