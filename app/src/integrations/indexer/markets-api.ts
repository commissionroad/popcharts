export type IndexedMarketStatus =
  | "bootstrap"
  | "graduating"
  | "graduated"
  | "resolved"
  | "refunded"
  | "cancelled";

export type IndexedMarket = {
  chainId: number;
  collateral: string;
  createdAt: string;
  createdBlockNumber: string;
  createdBlockTimestamp: string;
  createdLogIndex: number;
  createdTransactionHash: string;
  creator: string;
  graduationThreshold: string;
  graduationTime: string;
  liquidityParameter: string;
  marketId: string;
  metadataHash: string;
  noShares: string;
  openingProbabilityWad: string;
  receiptCount: string;
  resolutionTime: string;
  status: IndexedMarketStatus;
  totalEscrowed: string;
  updatedAt: string;
  yesShares: string;
};

export type IndexedMarketCreatedEvent = {
  blockNumber: string;
  blockTimestamp: string;
  chainId: number;
  collateral: string;
  creator: string;
  graduationThreshold: string;
  graduationTime: string;
  graduationTimeUnix: string;
  liquidityParameter: string;
  logIndex: number;
  marketId: string;
  metadataHash: string;
  openingProbabilityWad: string;
  resolutionTime: string;
  resolutionTimeUnix: string;
  transactionHash: string;
};

export type ListIndexedMarketsParams = {
  chainId?: number;
  since?: string;
};

export type IndexedMarketLookup = {
  chainId: number;
  marketId: string;
};

export type IndexerFetch = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export type IndexerMarketsApiClient = {
  getMarket: (lookup: IndexedMarketLookup) => Promise<IndexedMarket | null>;
  getMarketEvents: (
    lookup: IndexedMarketLookup
  ) => Promise<IndexedMarketCreatedEvent[]>;
  getMarkets: (params?: ListIndexedMarketsParams) => Promise<IndexedMarket[]>;
};

export class IndexerMarketsApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "IndexerMarketsApiError";
  }
}

export function createIndexerMarketsApiClient({
  baseUrl,
  fetcher = fetch,
}: {
  baseUrl: string;
  fetcher?: IndexerFetch;
}): IndexerMarketsApiClient {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  return {
    async getMarket({ chainId, marketId }) {
      const response = await requestJson(
        fetcher,
        new URL(
          `/markets/${encodeURIComponent(chainId)}/${encodeURIComponent(marketId)}`,
          normalizedBaseUrl
        )
      );

      if (response === null) {
        return null;
      }

      return parseIndexedMarket(response);
    },
    async getMarketEvents({ chainId, marketId }) {
      const response = await requestJson(
        fetcher,
        new URL(
          `/markets/${encodeURIComponent(chainId)}/${encodeURIComponent(
            marketId
          )}/events`,
          normalizedBaseUrl
        )
      );

      if (response === null) {
        return [];
      }

      if (!Array.isArray(response)) {
        throw new IndexerMarketsApiError("Expected indexed market events array.");
      }

      return response.map(parseIndexedMarketCreatedEvent);
    },
    async getMarkets(params = {}) {
      const url = new URL("/markets", normalizedBaseUrl);

      if (params.chainId !== undefined) {
        url.searchParams.set("chainId", params.chainId.toString());
      }

      if (params.since) {
        url.searchParams.set("since", params.since);
      }

      const response = await requestJson(fetcher, url);

      if (response === null) {
        return [];
      }

      if (!Array.isArray(response)) {
        throw new IndexerMarketsApiError("Expected indexed markets array.");
      }

      return response.map(parseIndexedMarket);
    },
  };
}

async function requestJson(fetcher: IndexerFetch, url: URL) {
  const response = await fetcher(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new IndexerMarketsApiError(
      `Indexer API request failed (${response.status}): ${body || response.statusText}`,
      response.status
    );
  }

  return response.json() as Promise<unknown>;
}

function normalizeBaseUrl(baseUrl: string) {
  return new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

function parseIndexedMarket(value: unknown): IndexedMarket {
  const record = requireRecord(value, "indexed market");
  const status = requireString(record, "status");

  if (!isIndexedMarketStatus(status)) {
    throw new IndexerMarketsApiError(`Unknown indexed market status: ${status}`);
  }

  return {
    chainId: requireNumber(record, "chainId"),
    collateral: requireString(record, "collateral"),
    createdAt: requireString(record, "createdAt"),
    createdBlockNumber: requireString(record, "createdBlockNumber"),
    createdBlockTimestamp: requireString(record, "createdBlockTimestamp"),
    createdLogIndex: requireNumber(record, "createdLogIndex"),
    createdTransactionHash: requireString(record, "createdTransactionHash"),
    creator: requireString(record, "creator"),
    graduationThreshold: requireString(record, "graduationThreshold"),
    graduationTime: requireString(record, "graduationTime"),
    liquidityParameter: requireString(record, "liquidityParameter"),
    marketId: requireString(record, "marketId"),
    metadataHash: requireString(record, "metadataHash"),
    noShares: requireString(record, "noShares"),
    openingProbabilityWad: requireString(record, "openingProbabilityWad"),
    receiptCount: requireString(record, "receiptCount"),
    resolutionTime: requireString(record, "resolutionTime"),
    status,
    totalEscrowed: requireString(record, "totalEscrowed"),
    updatedAt: requireString(record, "updatedAt"),
    yesShares: requireString(record, "yesShares"),
  };
}

function parseIndexedMarketCreatedEvent(value: unknown): IndexedMarketCreatedEvent {
  const record = requireRecord(value, "indexed market event");

  return {
    blockNumber: requireString(record, "blockNumber"),
    blockTimestamp: requireString(record, "blockTimestamp"),
    chainId: requireNumber(record, "chainId"),
    collateral: requireString(record, "collateral"),
    creator: requireString(record, "creator"),
    graduationThreshold: requireString(record, "graduationThreshold"),
    graduationTime: requireString(record, "graduationTime"),
    graduationTimeUnix: requireString(record, "graduationTimeUnix"),
    liquidityParameter: requireString(record, "liquidityParameter"),
    logIndex: requireNumber(record, "logIndex"),
    marketId: requireString(record, "marketId"),
    metadataHash: requireString(record, "metadataHash"),
    openingProbabilityWad: requireString(record, "openingProbabilityWad"),
    resolutionTime: requireString(record, "resolutionTime"),
    resolutionTimeUnix: requireString(record, "resolutionTimeUnix"),
    transactionHash: requireString(record, "transactionHash"),
  };
}

function isIndexedMarketStatus(value: string): value is IndexedMarketStatus {
  return (
    value === "bootstrap" ||
    value === "graduating" ||
    value === "graduated" ||
    value === "resolved" ||
    value === "refunded" ||
    value === "cancelled"
  );
}

function requireRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IndexerMarketsApiError(`Expected ${label} object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string) {
  const value = record[key];

  if (typeof value !== "string") {
    throw new IndexerMarketsApiError(`Expected ${key} to be a string.`);
  }

  return value;
}

function requireNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];

  if (typeof value !== "number") {
    throw new IndexerMarketsApiError(`Expected ${key} to be a number.`);
  }

  return value;
}
