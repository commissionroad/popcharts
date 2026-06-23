import { describe, expect, it, vi } from "vitest";

import type { ApiMarket, MarketsApiClient } from "@/integrations/indexer/markets-api";

import { markets as fixtureMarkets } from "./fixtures";
import {
  getMarketById,
  getMarkets,
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
  it("can still use fixture-backed markets explicitly", async () => {
    await expect(getMarkets({ source: "fixtures" })).resolves.toBe(fixtureMarkets);
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
});

function createClient({
  close,
  graduation,
  market = null,
  markets = [],
}: {
  close?: Awaited<ReturnType<MarketsApiClient["closePregradMarket"]>>;
  graduation?: Awaited<ReturnType<MarketsApiClient["graduateMarket"]>>;
  market?: ApiMarket | null;
  markets?: ApiMarket[];
} = {}): MarketsApiClient {
  return {
    closePregradMarket: vi.fn(async () => {
      if (!close) {
        throw new Error("Missing dev close fixture.");
      }

      return close;
    }),
    graduateMarket: vi.fn(async () => {
      if (!graduation) {
        throw new Error("Missing graduation fixture.");
      }

      return graduation;
    }),
    getMarket: vi.fn(async () => market),
    getMarketEvents: vi.fn(async () => []),
    getMarkets: vi.fn(async () => markets),
  };
}
