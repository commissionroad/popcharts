import { describe, expect, it, type MockedFunction, vi } from "vitest";

import {
  type ApiMarket,
  createMarketsApiClient,
  type MarketsApiFetch,
} from "./markets-api";

const apiMarket: ApiMarket = {
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
  receiptCount: "0",
  resolutionTime: "2026-07-01T12:00:00.000Z",
  status: "bootstrap",
  totalEscrowed: "0",
  updatedAt: "2026-06-13T12:00:00.000Z",
  yesShares: "0",
};

describe("createMarketsApiClient", () => {
  it("fetches markets with the documented query parameters", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(async () =>
      jsonResponse([apiMarket])
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    await client.getMarkets({
      chainId: "84532",
      since: "2026-06-13T12:00:00.000Z",
    });

    const [input, init] = firstFetchCall(fetcher);
    const url = new URL(String(input));

    expect(url.origin).toBe("http://localhost:3001");
    expect(url.pathname).toBe("/markets");
    expect(url.searchParams.get("chainId")).toBe("84532");
    expect(url.searchParams.get("since")).toBe("2026-06-13T12:00:00.000Z");
    expect(init?.cache).toBe("no-store");
    expect(init?.headers).toEqual({ accept: "application/json" });
  });

  it("fetches an individual API market", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(async () =>
      jsonResponse(apiMarket)
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001/",
      fetcher,
    });

    const market = await client.getMarket({ chainId: 84532, marketId: "7" });

    expect(market?.marketId).toBe("7");
    expect(String(firstFetchCall(fetcher)[0])).toBe(
      "http://localhost:3001/markets/84532/7"
    );
  });

  it("returns null for a missing API market", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(
      async () => new Response("Market not found", { status: 404 })
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    await expect(client.getMarket({ chainId: 84532, marketId: "404" })).resolves.toBe(
      null
    );
  });

  it("fetches market events", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(async () =>
      jsonResponse([
        {
          blockNumber: "123",
          blockTimestamp: "2026-06-13T12:00:00.000Z",
          chainId: 84532,
          collateral: apiMarket.collateral,
          creator: apiMarket.creator,
          graduationThreshold: apiMarket.graduationThreshold,
          graduationTime: apiMarket.graduationTime,
          graduationTimeUnix: "1781956800",
          liquidityParameter: apiMarket.liquidityParameter,
          logIndex: 4,
          marketId: "7",
          metadataHash: apiMarket.metadataHash,
          openingProbabilityWad: apiMarket.openingProbabilityWad,
          resolutionTime: apiMarket.resolutionTime,
          resolutionTimeUnix: "1782916800",
          transactionHash: apiMarket.createdTransactionHash,
        },
      ])
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    const events = await client.getMarketEvents({ chainId: 84532, marketId: "7" });

    expect(events).toHaveLength(1);
    expect(String(firstFetchCall(fetcher)[0])).toBe(
      "http://localhost:3001/markets/84532/7/events"
    );
  });
});

function firstFetchCall(fetcher: MockedFunction<MarketsApiFetch>) {
  const call = fetcher.mock.calls[0];

  if (!call) {
    throw new Error("Expected fetcher to be called.");
  }

  return call;
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
