import { afterEach, describe, expect, it, type MockedFunction, vi } from "vitest";

import type {
  ApiMarket,
  MarketsApiClient,
  MarketsApiFetch,
} from "@/integrations/indexer/markets-api";

import { markets as fixtureMarkets } from "./fixtures";
import {
  getMarketById,
  getMarkets,
  getMarketPricePath,
  requestDevMarketGraduation,
  requestDevMarketResolution,
  requestMarketGraduation,
  requestPregradMarketCloseForRefund,
  usesFixtureMarkets,
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

  it("serves the unified price path as-is", async () => {
    const client = createClient({
      priceHistory: {
        chainId: 5042002,
        graduatedAt: "2026-07-01T00:00:00.000Z",
        marketId: "7",
        points: [
          { at: "2026-07-01T00:00:00.000Z", noCents: 50, yesCents: 50 },
          { at: "2026-07-01T01:00:00.000Z", noCents: 46.0491, yesCents: 49.7945 },
        ],
      },
    });

    const path = await getMarketPricePath("5042002:7", {
      client,
      source: "api",
    });

    expect(client.getMarketPriceHistory).toHaveBeenCalledWith({
      chainId: 5042002,
      marketId: "7",
    });
    // The wire shape IS the chart shape — no mapping, no rounding.
    expect(path.points).toEqual([
      { at: "2026-07-01T00:00:00.000Z", noCents: 50, yesCents: 50 },
      { at: "2026-07-01T01:00:00.000Z", noCents: 46.0491, yesCents: 49.7945 },
    ]);
    // No live venue ticks in the read -> no venue seeds.
    expect(path.streams).toEqual({});
  });

  it("carries the per-stream seed ordinals alongside the points", async () => {
    const pool = `0x${"aa".repeat(32)}`;
    const client = createClient({
      priceHistory: {
        chainId: 5042002,
        graduatedAt: "2026-07-01T00:00:00.000Z",
        marketId: "7",
        points: [{ at: "2026-07-01T00:00:00.000Z", noCents: 50, yesCents: 50 }],
        streams: { [pool]: 4 },
      },
    });

    await expect(
      getMarketPricePath("5042002:7", { client, source: "api" })
    ).resolves.toEqual({
      points: [{ at: "2026-07-01T00:00:00.000Z", noCents: 50, yesCents: 50 }],
      streams: { [pool]: 4 },
    });
  });

  it("returns an empty path when the read answers an empty history", async () => {
    const client = createClient({
      priceHistory: { chainId: 5042002, marketId: "7", points: [] },
    });

    await expect(
      getMarketPricePath("5042002:7", { client, source: "api" })
    ).resolves.toEqual({ points: [], streams: {} });
  });

  it("returns an empty path when the read answers nothing", async () => {
    const client = createClient();

    await expect(
      getMarketPricePath("5042002:7", { client, source: "api" })
    ).resolves.toEqual({ points: [], streams: {} });
  });

  it("returns an empty path for fixture-backed markets", async () => {
    await expect(
      getMarketPricePath("eth-5000-august", { source: "fixtures" })
    ).resolves.toEqual({ points: [], streams: {} });
  });

  it("degrades to an empty path when the history read fails", async () => {
    // The market read is load-bearing; this one is not. A page that threw
    // here would lose its whole chart instead of falling back to the market's
    // synthetic path.
    const failure = new Error("Markets API request failed (502): bad gateway");
    const client = createClient();
    client.getMarketPriceHistory = vi.fn(async () => {
      throw failure;
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      getMarketPricePath("5042002:7", { client, source: "api" })
    ).resolves.toEqual({ points: [], streams: {} });
    // Degraded, not silent.
    expect(logged).toHaveBeenCalledWith(
      "[popcharts] error",
      failure,
      expect.objectContaining({ operation: "getMarketPricePath" })
    );

    logged.mockRestore();
  });

  it("returns an empty path for bare ids without a chain id", async () => {
    const client = createClient();

    await expect(getMarketPricePath("7", { client, source: "api" })).resolves.toEqual({
      points: [],
      streams: {},
    });
    expect(client.getMarketPriceHistory).not.toHaveBeenCalled();
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

  it("treats an auto-source lookup miss as a missing market, never a fixture", async () => {
    const client = createClient({ market: null });

    await expect(
      getMarketById("eth-5000-august", { chainId: 5042002, client, source: "auto" })
    ).resolves.toBeUndefined();
    expect(client.getMarket).toHaveBeenCalledWith({
      chainId: 5042002,
      marketId: "eth-5000-august",
    });
  });

  it("answers undefined for bare ids without a chain id in auto mode", async () => {
    const client = createClient({ market: apiMarket });

    await expect(
      getMarketById("eth-5000-august", { client, source: "auto" })
    ).resolves.toBeUndefined();
    expect(client.getMarket).not.toHaveBeenCalled();
  });

  it("serves an empty board when auto mode has no API to ask", async () => {
    vi.stubEnv("POPCHARTS_INDEXER_API_URL", "");
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL", "");

    await expect(getMarkets({ source: "auto" })).resolves.toEqual([]);
    await expect(
      getMarketById("eth-5000-august", { source: "auto" })
    ).resolves.toBeUndefined();
    expect(usesFixtureMarkets({ source: "auto" })).toBe(false);
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

  it("forwards the status filter as a comma-separated list", async () => {
    const client = createClient({ markets: [apiMarket] });

    await getMarkets({
      chainId: 5042002,
      client,
      source: "api",
      statuses: ["resolution_pending", "disputed"],
    });

    expect(client.getMarkets).toHaveBeenCalledWith({
      chainId: "5042002",
      status: "resolution_pending,disputed",
    });
  });

  it("omits the status parameter for an unfiltered view", async () => {
    const client = createClient({ markets: [apiMarket] });

    await getMarkets({ chainId: 5042002, client, source: "api", statuses: [] });

    expect(client.getMarkets).toHaveBeenCalledWith({ chainId: "5042002" });
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

  it("defaults to an empty board in auto mode without an indexer URL", async () => {
    await expect(getMarkets()).resolves.toEqual([]);
    await expect(getMarkets({ chainId: 5042002 })).resolves.toEqual([]);
  });

  it("reports fixture-backed reads so the UI can label sample data", () => {
    // Only the explicit fixtures source is fixture-backed; auto without an
    // API URL is an empty board, not sample data.
    expect(usesFixtureMarkets()).toBe(false);
    expect(usesFixtureMarkets({ source: "fixtures", chainId: 5042002 })).toBe(true);
    expect(
      usesFixtureMarkets({ apiBaseUrl: "http://localhost:3999", source: "api" })
    ).toBe(false);
  });
});

function createClient({
  close,
  devGraduation,
  devResolution,
  graduation,
  market = null,
  markets = [],
  priceHistory = null,
}: {
  close?: Awaited<ReturnType<MarketsApiClient["closePregradMarket"]>>;
  devGraduation?: Awaited<ReturnType<MarketsApiClient["graduateDevMarket"]>>;
  devResolution?: Awaited<ReturnType<MarketsApiClient["resolveDevMarket"]>>;
  graduation?: Awaited<ReturnType<MarketsApiClient["graduateMarket"]>>;
  market?: ApiMarket | null;
  markets?: ApiMarket[];
  priceHistory?: Awaited<ReturnType<MarketsApiClient["getMarketPriceHistory"]>>;
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
    getMarketPriceHistory: vi.fn(async () => priceHistory),
    getMarkets: vi.fn(async () => markets),
    getPortfolio: vi.fn(async () => null),
    listMarketOrders: vi.fn(async () => []),
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
