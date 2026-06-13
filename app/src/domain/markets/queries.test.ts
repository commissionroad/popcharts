import { describe, expect, it, vi } from "vitest";

import type {
  IndexedMarket,
  IndexerMarketsApiClient,
} from "@/integrations/indexer/markets-api";

import { markets as fixtureMarkets } from "./fixtures";
import { getMarketById, getMarkets } from "./queries";

const indexedMarket: IndexedMarket = {
  chainId: 84532,
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

describe("market queries", () => {
  it("can still use fixture-backed markets explicitly", async () => {
    await expect(getMarkets({ source: "fixtures" })).resolves.toBe(fixtureMarkets);
    await expect(
      getMarketById("eth-5000-august", { source: "fixtures" })
    ).resolves.toBe(fixtureMarkets[0]);
  });

  it("maps GET /markets responses into app markets", async () => {
    const client = createClient({ markets: [indexedMarket] });

    const markets = await getMarkets({
      chainId: 84532,
      client,
      source: "api",
    });

    expect(client.getMarkets).toHaveBeenCalledWith({ chainId: 84532 });
    expect(markets[0]).toMatchObject({
      b: 5_000,
      closesAt: "2026-07-01T12:00:00.000Z",
      graduationTargetUsd: 40_000,
      id: "84532:7",
      matchedUsd: 125,
      noPriceCents: 50,
      openingProbability: 50,
      question: "Market #7",
      receiptCount: 2,
      status: "bootstrap",
      volumeUsd: 125,
      yesPriceCents: 50,
    });
  });

  it("reads individual API markets by chain-prefixed app id", async () => {
    const client = createClient({ market: indexedMarket });

    const market = await getMarketById("84532:7", {
      client,
      source: "api",
    });

    expect(client.getMarket).toHaveBeenCalledWith({
      chainId: 84532,
      marketId: "7",
    });
    expect(market?.id).toBe("84532:7");
  });

  it("reads individual API markets with a configured chain id", async () => {
    const client = createClient({ market: indexedMarket });

    await getMarketById("7", {
      chainId: 84532,
      client,
      source: "api",
    });

    expect(client.getMarket).toHaveBeenCalledWith({
      chainId: 84532,
      marketId: "7",
    });
  });
});

function createClient({
  market = null,
  markets = [],
}: {
  market?: IndexedMarket | null;
  markets?: IndexedMarket[];
} = {}): IndexerMarketsApiClient {
  return {
    getMarket: vi.fn(async () => market),
    getMarketEvents: vi.fn(async () => []),
    getMarkets: vi.fn(async () => markets),
  };
}
