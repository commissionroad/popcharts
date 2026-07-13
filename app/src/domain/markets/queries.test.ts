import { afterEach, describe, expect, it, type MockedFunction, vi } from "vitest";

import type {
  ApiMarket,
  MarketsApiClient,
  MarketsApiFetch,
} from "@/integrations/indexer/markets-api";

import { markets as fixtureMarkets } from "./fixtures";
import {
  getMarketById,
  getMarketReceipts,
  getMarkets,
  requestDevMarketGraduation,
  requestDevMarketResolution,
  requestMarketGraduation,
  requestPregradMarketCloseForRefund,
} from "./queries";

const apiMarket: ApiMarket = {
  bypassAiResolution: false,
  chainId: 5042002,
  collateral: "0x0000000000000000000000000000000000000001",
  createdAt: "2026-06-13T12:00:00.000Z",
  createdBlockNumber: "123",
  createdBlockTimestamp: "2026-06-13T12:00:00.000Z",
  createdLogIndex: 4,
  createdTransactionHash:
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  creator: "0x0000000000000000000000000000000000000002",
  graduationThreshold: "40000000000000000000000",
  graduationTime: "2026-06-20T12:00:00.000Z",
  liquidityParameter: "5000000000000000000000",
  marketId: "7",
  matchedMarketCap: "0",
  metadataHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  noShares: "0",
  openingProbabilityWad: "500000000000000000",
  receiptCount: "2",
  resolutionTime: "2026-07-01T12:00:00.000Z",
  status: "bootstrap",
  totalEscrowed: "125000000000000000000",
  updatedAt: "2026-06-13T12:00:00.000Z",
  yesShares: "0",
};
const metadata = {
  category: "Politics",
  chainId: apiMarket.chainId,
  createdAt: "2026-06-13T12:01:00.000Z",
  description: "Resolves using the official source.",
  metadataCreatedAt: "2026-06-13T12:01:00.000Z",
  metadataHash: apiMarket.metadataHash,
  question: "Will this local market show its real question?",
  resolutionCriteria: "Resolves YES if the event happens.",
  updatedAt: "2026-06-13T12:01:00.000Z",
};

describe("market queries", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("can still use fixture-backed markets explicitly", async () => {
    await expect(getMarkets({ source: "fixtures" })).resolves.toBe(fixtureMarkets);
    await expect(getMarkets({ chainId: 5042002, source: "fixtures" })).resolves.toBe(
      fixtureMarkets
    );
    await expect(
      getMarketById("eth-5000-august", { source: "fixtures" })
    ).resolves.toBe(fixtureMarkets[0]);
  });

  it("maps GET /markets responses into app markets", async () => {
    const client = createClient({ markets: [{ ...apiMarket, metadata }] });

    const markets = await getMarkets({
      chainId: 5042002,
      client,
      source: "api",
    });

    expect(client.getMarkets).toHaveBeenCalledWith({ chainId: "5042002" });
    expect(markets[0]).toMatchObject({
      b: 5_000,
      category: "Politics",
      closesAt: "2026-07-01T12:00:00.000Z",
      description: "Resolves using the official source.",
      graduationTargetUsd: 40_000,
      id: "5042002:7",
      matchedUsd: 0,
      noPriceCents: 50,
      openingProbability: 50,
      question: "Will this local market show its real question?",
      receiptCount: 2,
      status: "bootstrap",
      volumeUsd: 125,
      yesPriceCents: 50,
    });
  });

  it("maps indexed receipt shares into current app prices", async () => {
    const client = createClient({
      markets: [
        {
          ...apiMarket,
          matchedMarketCap: "25000000000000000000",
          metadata,
          totalEscrowed: "50400000000000000000",
          yesShares: "100000000000000000000",
        },
      ],
    });

    const [market] = await getMarkets({
      chainId: 5042002,
      client,
      source: "api",
    });

    expect(market?.openingProbability).toBe(50);
    expect(market?.yesPriceCents).toBeGreaterThan(50);
    expect(market?.noPriceCents).toBeLessThan(50);
    expect(market?.matchedUsd).toBe(25);
    expect(market?.volumeUsd).toBe(50.4);
  });

  it("reads individual API markets by chain-prefixed app id", async () => {
    const client = createClient({ market: apiMarket });

    const market = await getMarketById("5042002:7", {
      client,
      source: "api",
    });

    expect(client.getMarket).toHaveBeenCalledWith({
      chainId: 5042002,
      marketId: "7",
    });
    expect(market?.id).toBe("5042002:7");
  });

  it("reads market receipts by chain-prefixed app id", async () => {
    const receipt = {
      blockNumber: "111",
      blockTimestamp: "2026-06-13T12:05:00.000Z",
      chainId: 5042002,
      cost: "3288901914750925000",
      logIndex: 1,
      marketId: "7",
      owner: "0x0000000000000000000000000000000000000003",
      receiptId: "1",
      sequence: "1",
      shares: "6000000000000000000",
      side: 0,
      transactionHash:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    };
    const client = createClient({ receipts: [receipt] });

    const receipts = await getMarketReceipts("5042002:7", {
      client,
      source: "api",
    });

    expect(client.getMarketReceipts).toHaveBeenCalledWith({
      chainId: 5042002,
      marketId: "7",
    });
    expect(receipts).toEqual([receipt]);
  });

  it("returns no receipts for fixture-backed markets", async () => {
    await expect(
      getMarketReceipts("eth-5000-august", { source: "fixtures" })
    ).resolves.toEqual([]);
  });

  it("reads individual API markets by URL-encoded chain-prefixed app id", async () => {
    const client = createClient({ market: apiMarket });

    const market = await getMarketById("5042002%3A7", {
      client,
      source: "api",
    });

    expect(client.getMarket).toHaveBeenCalledWith({
      chainId: 5042002,
      marketId: "7",
    });
    expect(market?.id).toBe("5042002:7");
  });

  it("reads individual API markets with a configured chain id", async () => {
    const client = createClient({ market: apiMarket });

    await getMarketById("7", {
      chainId: 5042002,
      client,
      source: "api",
    });

    expect(client.getMarket).toHaveBeenCalledWith({
      chainId: 5042002,
      marketId: "7",
    });
  });

  it("requests graduation by chain-prefixed app id", async () => {
    const client = createClient({
      graduation: {
        market: { ...apiMarket, matchedMarketCap: apiMarket.graduationThreshold },
        status: "graduated",
        summary: {
          completeSetCount: apiMarket.graduationThreshold,
          graduatedAt: "2026-06-14T12:00:00.000Z",
          graduationThreshold: apiMarket.graduationThreshold,
          matchedMarketCap: apiMarket.graduationThreshold,
          noTokens: apiMarket.graduationThreshold,
          receiptCount: "10",
          refundedCollateral: "0",
          totalEscrowed: apiMarket.graduationThreshold,
          yesTokens: apiMarket.graduationThreshold,
        },
      },
    });

    const result = await requestMarketGraduation("5042002:7", {
      client,
      source: "api",
    });

    expect(client.graduateMarket).toHaveBeenCalledWith({
      chainId: 5042002,
      marketId: "7",
    });
    expect(result.status).toBe("graduated");
  });

  it("requests a dev graduation by chain-prefixed app id", async () => {
    const client = createClient({
      devGraduation: {
        market: { ...apiMarket, status: "graduated" },
        postgrad: {
          adapterAddress: "0x00000000000000000000000000000000000000ab",
          completeSetCount: apiMarket.graduationThreshold,
          finalizedAt: "2026-06-14T12:00:00.000Z",
          marketAddress: "0x00000000000000000000000000000000000000cd",
          refundTotal: "0",
          retainedCostTotal: apiMarket.graduationThreshold,
          transactionHash:
            "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        },
        status: "graduated",
        summary: {
          completeSetCount: apiMarket.graduationThreshold,
          graduatedAt: "2026-06-14T12:00:00.000Z",
          graduationThreshold: apiMarket.graduationThreshold,
          matchedMarketCap: apiMarket.graduationThreshold,
          noTokens: apiMarket.graduationThreshold,
          receiptCount: "10",
          refundedCollateral: "0",
          totalEscrowed: apiMarket.graduationThreshold,
          yesTokens: apiMarket.graduationThreshold,
        },
        transactionHashes: [
          "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        ],
      },
    });

    const result = await requestDevMarketGraduation("5042002:7", {
      client,
      source: "api",
    });

    expect(client.graduateDevMarket).toHaveBeenCalledWith({
      chainId: 5042002,
      force: false,
      marketId: "7",
    });
    expect(result.status).toBe("graduated");
    expect(result.postgrad.marketAddress).toBe(
      "0x00000000000000000000000000000000000000cd"
    );
  });

  it("requests a dev close by chain-prefixed app id", async () => {
    const client = createClient({
      close: {
        market: { ...apiMarket, status: "refunded" },
        refundAvailable: apiMarket.totalEscrowed,
        status: "refunded",
        transactionHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });

    const result = await requestPregradMarketCloseForRefund("5042002:7", {
      client,
      source: "api",
    });

    expect(client.closePregradMarket).toHaveBeenCalledWith({
      chainId: 5042002,
      marketId: "7",
    });
    expect(result.status).toBe("refunded");
  });

  it("requests a dev resolution by chain-prefixed app id", async () => {
    const client = createClient({
      devResolution: {
        market: { ...apiMarket, status: "resolved" },
        status: "resolved",
        transactionHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        winningSide: "yes",
      },
    });

    const result = await requestDevMarketResolution("5042002:7", "yes", {
      client,
      source: "api",
    });

    expect(client.resolveDevMarket).toHaveBeenCalledWith({
      chainId: 5042002,
      marketId: "7",
      side: "yes",
    });
    expect(result.status).toBe("resolved");
  });

  it("returns undefined when an api-source market is missing", async () => {
    const client = createClient({ market: null });

    await expect(
      getMarketById("5042002:404", { client, source: "api" })
    ).resolves.toBeUndefined();
  });

  it("returns undefined for bare ids without a chain id in api mode", async () => {
    const client = createClient({ market: apiMarket });

    await expect(
      getMarketById("7", { client, source: "api" })
    ).resolves.toBeUndefined();
    expect(client.getMarket).not.toHaveBeenCalled();
  });

  it("falls back to fixtures when an auto-source lookup misses", async () => {
    const client = createClient({ market: null });

    await expect(
      getMarketById("eth-5000-august", { chainId: 5042002, client, source: "auto" })
    ).resolves.toBe(fixtureMarkets[0]);
    expect(client.getMarket).toHaveBeenCalledWith({
      chainId: 5042002,
      marketId: "eth-5000-august",
    });
  });

  it("falls back to fixtures for bare ids without a chain id in auto mode", async () => {
    const client = createClient({ market: apiMarket });

    await expect(
      getMarketById("eth-5000-august", { client, source: "auto" })
    ).resolves.toBe(fixtureMarkets[0]);
    expect(client.getMarket).not.toHaveBeenCalled();
  });

  it("returns no receipts for bare ids without a chain id", async () => {
    const client = createClient();

    await expect(getMarketReceipts("7", { client, source: "api" })).resolves.toEqual(
      []
    );
    expect(client.getMarketReceipts).not.toHaveBeenCalled();
  });

  it("forwards the since parameter to the API client", async () => {
    const client = createClient({ markets: [apiMarket] });

    await getMarkets({
      chainId: 5042002,
      client,
      since: "2026-06-13T12:00:00.000Z",
      source: "api",
    });

    expect(client.getMarkets).toHaveBeenCalledWith({
      chainId: "5042002",
      since: "2026-06-13T12:00:00.000Z",
    });
  });

  it("rejects graduation requests for fixture-backed markets", async () => {
    await expect(
      requestMarketGraduation("eth-5000-august", { source: "fixtures" })
    ).rejects.toThrowError("Market graduation requires API-backed market data.");
  });

  it("rejects graduation requests without a chain-scoped id", async () => {
    const client = createClient();

    await expect(
      requestMarketGraduation("7", { client, source: "api" })
    ).rejects.toThrowError("Market graduation requires a chain-prefixed market id.");
  });

  it("rejects dev close requests for fixture-backed markets", async () => {
    await expect(
      requestPregradMarketCloseForRefund("eth-5000-august", { source: "fixtures" })
    ).rejects.toThrowError("Dev market close requires API-backed market data.");
  });

  it("rejects dev close requests without a chain-scoped id", async () => {
    const client = createClient();

    await expect(
      requestPregradMarketCloseForRefund("7", { client, source: "api" })
    ).rejects.toThrowError("Dev market close requires a chain-prefixed market id.");
  });

  it("rejects dev resolution requests for fixture-backed markets", async () => {
    await expect(
      requestDevMarketResolution("eth-5000-august", "yes", {
        source: "fixtures",
      })
    ).rejects.toThrowError("Dev market resolution requires API-backed market data.");
  });

  it("rejects dev resolution requests without a chain-scoped id", async () => {
    const client = createClient();

    await expect(
      requestDevMarketResolution("7", "no", { client, source: "api" })
    ).rejects.toThrowError(
      "Dev market resolution requires a chain-prefixed market id."
    );
  });

  it("passes the force flag through to the dev graduation client", async () => {
    const client = createClient({
      devGraduation: {
        market: { ...apiMarket, status: "graduated" },
        postgrad: {
          adapterAddress: "0x00000000000000000000000000000000000000ab",
          completeSetCount: apiMarket.graduationThreshold,
          finalizedAt: "2026-06-14T12:00:00.000Z",
          marketAddress: "0x00000000000000000000000000000000000000cd",
          refundTotal: "0",
          retainedCostTotal: apiMarket.graduationThreshold,
          transactionHash:
            "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        },
        status: "graduated",
        summary: {
          completeSetCount: apiMarket.graduationThreshold,
          graduatedAt: "2026-06-14T12:00:00.000Z",
          graduationThreshold: apiMarket.graduationThreshold,
          matchedMarketCap: apiMarket.graduationThreshold,
          noTokens: apiMarket.graduationThreshold,
          receiptCount: "10",
          refundedCollateral: "0",
          totalEscrowed: apiMarket.graduationThreshold,
          yesTokens: apiMarket.graduationThreshold,
        },
        transactionHashes: [],
      },
    });

    await requestDevMarketGraduation("5042002:7", {
      client,
      force: true,
      source: "api",
    });

    expect(client.graduateDevMarket).toHaveBeenCalledWith({
      chainId: 5042002,
      force: true,
      marketId: "7",
    });
  });

  it("rejects dev graduation requests for fixture-backed markets", async () => {
    await expect(
      requestDevMarketGraduation("eth-5000-august", { source: "fixtures" })
    ).rejects.toThrowError("Dev market graduation requires API-backed market data.");
  });

  it("rejects dev graduation requests without a chain-scoped id", async () => {
    const client = createClient();

    await expect(
      requestDevMarketGraduation("7", { client, source: "api" })
    ).rejects.toThrowError(
      "Dev market graduation requires a chain-prefixed market id."
    );
  });

  it("requires an indexer URL when the api source is forced", async () => {
    await expect(getMarkets({ source: "api" })).rejects.toThrowError(
      "POPCHARTS_INDEXER_API_URL is required when POPCHARTS_MARKET_DATA_SOURCE=api."
    );
  });

  it("builds an API client from an explicit base URL and fetcher", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(async () =>
      jsonResponse([apiMarket])
    );

    const markets = await getMarkets({
      apiBaseUrl: "http://localhost:3999",
      fetcher,
      source: "api",
    });

    expect(markets[0]?.id).toBe("5042002:7");
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.origin).toBe("http://localhost:3999");
    expect(url.pathname).toBe("/markets");
  });

  it("reads the indexer URL and chain id from the environment", async () => {
    vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://localhost:3999");
    vi.stubEnv("POPCHARTS_MARKETS_CHAIN_ID", "5042002");
    const fetchMock: MockedFunction<MarketsApiFetch> = vi.fn(async () =>
      jsonResponse([apiMarket])
    );
    vi.stubGlobal("fetch", fetchMock);

    const markets = await getMarkets({ source: "api" });

    expect(markets[0]?.id).toBe("5042002:7");
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.origin).toBe("http://localhost:3999");
    expect(url.searchParams.get("chainId")).toBe("5042002");
  });

  it("falls back to the public environment variables", async () => {
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL", "http://localhost:3999");
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_MARKETS_CHAIN_ID", "5042002");
    const fetchMock: MockedFunction<MarketsApiFetch> = vi.fn(async () =>
      jsonResponse([apiMarket])
    );
    vi.stubGlobal("fetch", fetchMock);

    const markets = await getMarkets({ source: "api" });

    expect(markets[0]?.id).toBe("5042002:7");
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("chainId")).toBe("5042002");
  });

  it("rejects unparseable chain id configuration", async () => {
    vi.stubEnv("POPCHARTS_MARKETS_CHAIN_ID", "mainnet");
    const client = createClient();

    await expect(getMarkets({ client, source: "api" })).rejects.toThrowError(
      "Invalid POPCHARTS_MARKETS_CHAIN_ID: mainnet"
    );
  });

  it("reads the data source from the environment", async () => {
    vi.stubEnv("POPCHARTS_MARKET_DATA_SOURCE", "fixtures");

    await expect(getMarkets()).resolves.toBe(fixtureMarkets);
  });

  it("rejects unknown data source configuration", async () => {
    vi.stubEnv("POPCHARTS_MARKET_DATA_SOURCE", "csv");

    await expect(getMarkets()).rejects.toThrowError(
      "Invalid POPCHARTS_MARKET_DATA_SOURCE: csv"
    );
  });

  it("defaults to fixtures in auto mode without an indexer URL", async () => {
    await expect(getMarkets()).resolves.toBe(fixtureMarkets);
    await expect(getMarkets({ chainId: 5042002 })).resolves.toBe(fixtureMarkets);
  });
});

function createClient({
  close,
  devGraduation,
  devResolution,
  graduation,
  market = null,
  markets = [],
  receipts = [],
}: {
  close?: Awaited<ReturnType<MarketsApiClient["closePregradMarket"]>>;
  devGraduation?: Awaited<ReturnType<MarketsApiClient["graduateDevMarket"]>>;
  devResolution?: Awaited<ReturnType<MarketsApiClient["resolveDevMarket"]>>;
  graduation?: Awaited<ReturnType<MarketsApiClient["graduateMarket"]>>;
  market?: ApiMarket | null;
  markets?: ApiMarket[];
  receipts?: Awaited<ReturnType<MarketsApiClient["getMarketReceipts"]>>;
} = {}): MarketsApiClient {
  return {
    closePregradMarket: vi.fn(async () => {
      if (!close) {
        throw new Error("Missing dev close fixture.");
      }

      return close;
    }),
    graduateDevMarket: vi.fn(async () => {
      if (!devGraduation) {
        throw new Error("Missing dev graduation fixture.");
      }

      return devGraduation;
    }),
    graduateMarket: vi.fn(async () => {
      if (!graduation) {
        throw new Error("Missing graduation fixture.");
      }

      return graduation;
    }),
    resolveDevMarket: vi.fn(async () => {
      if (!devResolution) {
        throw new Error("Missing dev resolution fixture.");
      }

      return devResolution;
    }),
    getMarket: vi.fn(async () => market),
    getMarketEvents: vi.fn(async () => []),
    getMarketOrderBook: vi.fn(async () => null),
    getMarketReceipts: vi.fn(async () => receipts),
    getMarkets: vi.fn(async () => markets),
    getPortfolio: vi.fn(async () => null),
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
