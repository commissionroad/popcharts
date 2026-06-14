import {
  getGetMarketsByChainIdByMarketIdEventsUrl,
  getGetMarketsByChainIdByMarketIdUrl,
  getGetMarketsUrl,
} from "./generated/markets/markets";
import type { GetMarketsParams, Market, MarketCreatedEvent } from "./generated/models";

export type ApiMarketMetadata = {
  category: string;
  chainId: number;
  createdAt: string;
  description: string;
  metadataCreatedAt: string;
  metadataHash: string;
  question: string;
  resolutionCriteria: string;
  resolutionUrl?: string;
  updatedAt: string;
};

export type ApiMarket = Market & {
  metadata?: ApiMarketMetadata;
};
export type ApiMarketCreatedEvent = MarketCreatedEvent;
export type ListMarketsParams = GetMarketsParams;

export type MarketApiLookup = {
  chainId: number | string;
  marketId: string;
};

export type MarketsApiFetch = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export type MarketsApiClient = {
  getMarket: (lookup: MarketApiLookup) => Promise<ApiMarket | null>;
  getMarketEvents: (lookup: MarketApiLookup) => Promise<ApiMarketCreatedEvent[]>;
  getMarkets: (params?: ListMarketsParams) => Promise<ApiMarket[]>;
};

export class MarketsApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "MarketsApiError";
  }
}

export function createMarketsApiClient({
  baseUrl,
  fetcher = fetch,
}: {
  baseUrl: string;
  fetcher?: MarketsApiFetch;
}): MarketsApiClient {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  return {
    getMarket({ chainId, marketId }) {
      return requestJson<ApiMarket>(
        fetcher,
        buildUrl(
          normalizedBaseUrl,
          getGetMarketsByChainIdByMarketIdUrl(
            encodeURIComponent(String(chainId)),
            encodeURIComponent(marketId)
          )
        )
      );
    },
    async getMarketEvents({ chainId, marketId }) {
      const response = await requestJson<ApiMarketCreatedEvent[]>(
        fetcher,
        buildUrl(
          normalizedBaseUrl,
          getGetMarketsByChainIdByMarketIdEventsUrl(
            encodeURIComponent(String(chainId)),
            encodeURIComponent(marketId)
          )
        )
      );

      return response ?? [];
    },
    async getMarkets(params = {}) {
      const response = await requestJson<ApiMarket[]>(
        fetcher,
        buildUrl(normalizedBaseUrl, getGetMarketsUrl(params))
      );

      return response ?? [];
    },
  };
}

async function requestJson<T>(fetcher: MarketsApiFetch, url: URL): Promise<T | null> {
  const response = await fetcher(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new MarketsApiError(
      `Markets API request failed (${response.status}): ${body || response.statusText}`,
      response.status
    );
  }

  return response.json() as Promise<T>;
}

function normalizeBaseUrl(baseUrl: string) {
  return new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

function buildUrl(baseUrl: URL, path: string) {
  return new URL(path, baseUrl);
}
