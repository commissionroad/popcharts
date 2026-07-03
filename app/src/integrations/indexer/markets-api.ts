import { getCloseDevMarketUrl } from "./generated/development/development";
import { getGraduateMarketUrl } from "./generated/graduation/graduation";
import {
  getGetMarketUrl,
  getListMarketEventsUrl,
  getListMarketsUrl,
} from "./generated/markets/markets";
import type {
  DevMarketCloseResponse,
  GraduationResponse,
  GraduationSummary,
  ListMarketsParams as GeneratedListMarketsParams,
  Market,
  MarketCreatedEvent,
  MarketMetadata,
} from "./generated/models";

export type ApiMarketMetadata = MarketMetadata;
export type ApiMarket = Market;
export type ApiMarketCreatedEvent = MarketCreatedEvent;
export type ListMarketsParams = GeneratedListMarketsParams;
export type ApiGraduationSummary = GraduationSummary;
export type ApiGraduationResponse = GraduationResponse;
export type ApiDevMarketCloseResponse = DevMarketCloseResponse;

export type MarketApiLookup = {
  chainId: number | string;
  marketId: string;
};

export type MarketsApiFetch = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export type MarketsApiClient = {
  closePregradMarket: (lookup: MarketApiLookup) => Promise<ApiDevMarketCloseResponse>;
  graduateMarket: (lookup: MarketApiLookup) => Promise<ApiGraduationResponse>;
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
    async closePregradMarket({ chainId, marketId }) {
      const response = await requestJson<ApiDevMarketCloseResponse>(
        fetcher,
        buildUrl(
          normalizedBaseUrl,
          getCloseDevMarketUrl(
            encodeURIComponent(String(chainId)),
            encodeURIComponent(marketId)
          )
        ),
        { method: "POST" }
      );

      if (!response) {
        throw new MarketsApiError("Dev market close is disabled or unavailable.", 404);
      }

      return response;
    },
    async graduateMarket({ chainId, marketId }) {
      const response = await requestJson<ApiGraduationResponse>(
        fetcher,
        buildUrl(
          normalizedBaseUrl,
          getGraduateMarketUrl(
            encodeURIComponent(String(chainId)),
            encodeURIComponent(marketId)
          )
        ),
        { method: "POST" }
      );

      if (!response) {
        throw new MarketsApiError("Market not found.", 404);
      }

      return response;
    },
    getMarket({ chainId, marketId }) {
      return requestJson<ApiMarket>(
        fetcher,
        buildUrl(
          normalizedBaseUrl,
          getGetMarketUrl(
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
          getListMarketEventsUrl(
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
        buildUrl(normalizedBaseUrl, getListMarketsUrl(params))
      );

      return response ?? [];
    },
  };
}

async function requestJson<T>(
  fetcher: MarketsApiFetch,
  url: URL,
  init: RequestInit = {}
): Promise<T | null> {
  const response = await fetcher(url, {
    ...init,
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new MarketsApiError(
      `Markets API request failed (${response.status}): ${errorMessage(
        body,
        response.statusText
      )}`,
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

function errorMessage(body: string, statusText: string) {
  if (!body) {
    return statusText;
  }

  try {
    const parsed = JSON.parse(body) as { message?: unknown };

    if (typeof parsed.message === "string" && parsed.message.length > 0) {
      return parsed.message;
    }
  } catch {
    return body;
  }

  return body;
}
