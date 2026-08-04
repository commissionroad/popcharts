import {
  createMarketsApiClient,
  type ListMarketsParams,
  type MarketApiLookup,
  type MarketsApiClient,
  type MarketsApiFetch,
} from "@/integrations/indexer/markets-api";
import { parseApiMarketAppId } from "@/lib/app-id";
import { logError } from "@/lib/error-logger";

import { apiMarketToMarket } from "./api-market";
import { markets as fixtureMarkets } from "./fixtures";
import type { PricePoint } from "./types";

export type MarketDataSource = "auto" | "api" | "fixtures";
export type DevMarketResolutionSide = "yes" | "no";

export type MarketQueryOptions = {
  apiBaseUrl?: string;
  chainId?: number;
  client?: MarketsApiClient;
  fetcher?: MarketsApiFetch;
  since?: string;
  source?: MarketDataSource;
};

/**
 * True when market reads would come from the bundled fixtures rather than a
 * live indexer. The public UI must label fixture-backed markets as sample
 * data — they look like real markets but carry no live volume.
 */
export function usesFixtureMarkets(options: MarketQueryOptions = {}) {
  return !resolveMarketQueryConfig(options).useApi;
}

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

/**
 * Fetches a market's whole-life price history (repo ADR 0025): the server
 * replays the LMSR over the receipt book and, for a graduated market, appends
 * the bounded venue's prices past the handoff — one shape, oldest first.
 * Returns an empty list for a fixture-backed market, which has no indexer to
 * ask.
 *
 * A failed read reports the same empty list rather than throwing, which is
 * the one place this module deliberately swallows an error. The market read
 * itself is load-bearing — without it there is no page — but the chart is
 * not: the page falls back to the market's own synthetic path, so losing
 * chart fidelity beats losing the page.
 */
export async function getMarketPricePath(
  id: string,
  options: MarketQueryOptions = {}
): Promise<PricePoint[]> {
  const config = resolveMarketQueryConfig(options);

  if (!config.useApi) {
    return [];
  }

  const lookup = resolveMarketLookup(id, config.chainId);

  if (!lookup) {
    return [];
  }

  try {
    const history = await config.client.getMarketPriceHistory(lookup);

    return history?.points ?? [];
  } catch (error) {
    // Degraded, not silent: the chart falls back to the market's synthetic
    // path and the failure still reaches the logs rather than disappearing.
    logError(error, { marketId: id, operation: "getMarketPricePath" });

    return [];
  }
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

export async function requestDevMarketGraduation(
  id: string,
  options: MarketQueryOptions & { force?: boolean } = {}
) {
  const config = resolveMarketQueryConfig(options);

  if (!config.useApi) {
    throw new Error("Dev market graduation requires API-backed market data.");
  }

  const lookup = resolveMarketLookup(id, config.chainId);

  if (!lookup) {
    throw new Error("Dev market graduation requires a chain-prefixed market id.");
  }

  return config.client.graduateDevMarket({
    ...lookup,
    force: options.force ?? false,
  });
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

export async function requestDevMarketResolution(
  id: string,
  side: DevMarketResolutionSide,
  options: MarketQueryOptions = {}
) {
  const config = resolveMarketQueryConfig(options);

  if (!config.useApi) {
    throw new Error("Dev market resolution requires API-backed market data.");
  }

  const lookup = resolveMarketLookup(id, config.chainId);

  if (!lookup) {
    throw new Error("Dev market resolution requires a chain-prefixed market id.");
  }

  return config.client.resolveDevMarket({
    ...lookup,
    side,
  });
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
