import { describe, expect, it, type MockedFunction, vi } from "vitest";

import {
  type ApiMarket,
  createMarketsApiClient,
  type MarketsApiFetch,
} from "./markets-api";

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
      chainId: "5042002",
      since: "2026-06-13T12:00:00.000Z",
    });

    const [input, init] = firstFetchCall(fetcher);
    const url = new URL(String(input));

    expect(url.origin).toBe("http://localhost:3001");
    expect(url.pathname).toBe("/markets");
    expect(url.searchParams.get("chainId")).toBe("5042002");
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

    const market = await client.getMarket({ chainId: 5042002, marketId: "7" });

    expect(market?.marketId).toBe("7");
    expect(String(firstFetchCall(fetcher)[0])).toBe(
      "http://localhost:3001/markets/5042002/7"
    );
  });

  it("fetches a market's venue order book", async () => {
    const book = {
      chainId: 5042002,
      marketId: "7",
      yes: {
        asks: [],
        bids: [],
        outcomeTokenAddress: "0x0000000000000000000000000000000000000003",
        poolId: `0x${"1f".repeat(32)}`,
        side: "yes",
      },
    };
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(async () =>
      jsonResponse(book)
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    const orderBook = await client.getMarketOrderBook({
      chainId: 5042002,
      marketId: "7",
    });

    expect(orderBook).toEqual(book);
    expect(String(firstFetchCall(fetcher)[0])).toBe(
      "http://localhost:3001/markets/5042002/7/orderbook"
    );
  });

  it("returns null when the order book targets a missing market", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(
      async () => new Response("not found", { status: 404 })
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    await expect(
      client.getMarketOrderBook({ chainId: 5042002, marketId: "404" })
    ).resolves.toBeNull();
  });

  it("fetches a wallet's portfolio for the requested chain and owner", async () => {
    const portfolio = {
      chainId: 5042002,
      openOrders: [],
      owner: "0x1111111111111111111111111111111111111111",
      positions: [],
      receipts: [],
      summary: {
        claimableReceiptCount: 0,
        lockedCollateral: "0",
        openOrderCount: 0,
        openReceiptCount: 0,
        positionCount: 0,
        totalPositionValueWad: "0",
      },
    };
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(async () =>
      jsonResponse(portfolio)
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    const result = await client.getPortfolio({
      chainId: 5042002,
      owner: "0x1111111111111111111111111111111111111111",
    });

    expect(result).toEqual(portfolio);
    expect(String(firstFetchCall(fetcher)[0])).toBe(
      "http://localhost:3001/portfolio/5042002?owner=0x1111111111111111111111111111111111111111"
    );
  });

  it("requests graduation for an API market", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(async () =>
      jsonResponse({
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
      })
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001/",
      fetcher,
    });

    const result = await client.graduateMarket({
      chainId: 5042002,
      marketId: "7",
    });

    const [input, init] = firstFetchCall(fetcher);

    expect(result.status).toBe("graduated");
    expect(init?.method).toBe("POST");
    expect(String(input)).toBe("http://localhost:3001/markets/5042002/7/graduate");
  });

  it("requests a dev-only graduation for an API market", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(async () =>
      jsonResponse({
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
        transactionHashes: [],
      })
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001/",
      fetcher,
    });

    const result = await client.graduateDevMarket({
      chainId: 5042002,
      marketId: "7",
    });

    const [input, init] = firstFetchCall(fetcher);

    expect(result.status).toBe("graduated");
    expect(init?.method).toBe("POST");
    expect(String(input)).toBe("http://localhost:3001/dev/markets/5042002/7/graduate");
  });

  it("requests a dev-only pregrad close for an API market", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(async () =>
      jsonResponse({
        market: { ...apiMarket, status: "refunded" },
        refundAvailable: apiMarket.totalEscrowed,
        status: "refunded",
        transactionHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      })
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001/",
      fetcher,
    });

    const result = await client.closePregradMarket({
      chainId: 5042002,
      marketId: "7",
    });

    const [input, init] = firstFetchCall(fetcher);

    expect(result.status).toBe("refunded");
    expect(init?.method).toBe("POST");
    expect(String(input)).toBe("http://localhost:3001/dev/markets/5042002/7/close");
  });

  it("requests a dev-only resolution for an API market", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(async () =>
      jsonResponse({
        market: { ...apiMarket, status: "resolved" },
        status: "resolved",
        transactionHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        winningSide: "no",
      })
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001/",
      fetcher,
    });

    const result = await client.resolveDevMarket({
      chainId: 5042002,
      marketId: "7",
      side: "no",
    });

    const [input, init] = firstFetchCall(fetcher);

    expect(result.status).toBe("resolved");
    expect(init?.method).toBe("POST");
    expect(String(input)).toBe(
      "http://localhost:3001/dev/markets/5042002/7/resolve/no"
    );
  });

  it("surfaces graduation ineligibility messages", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            message: "Matched liquidity is below this market's graduation threshold.",
            status: "ineligible",
          }),
          { headers: { "content-type": "application/json" }, status: 409 }
        )
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    await expect(
      client.graduateMarket({ chainId: 5042002, marketId: "7" })
    ).rejects.toMatchObject({
      message:
        "Markets API request failed (409): Matched liquidity is below this market's graduation threshold.",
      status: 409,
    });
  });

  it("returns null for a missing API market", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(
      async () => new Response("Market not found", { status: 404 })
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    await expect(client.getMarket({ chainId: 5042002, marketId: "404" })).resolves.toBe(
      null
    );
  });

  it("fetches market events", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(async () =>
      jsonResponse([
        {
          blockNumber: "123",
          blockTimestamp: "2026-06-13T12:00:00.000Z",
          bypassAiResolution: false,
          chainId: 5042002,
          collateral: apiMarket.collateral,
          creator: apiMarket.creator,
          graduationThreshold: apiMarket.graduationThreshold,
          graduationTime: apiMarket.graduationTime,
          graduationTimeUnix: "1781956800",
          liquidityParameter: apiMarket.liquidityParameter,
          logIndex: 4,
          marketId: "7",
          metadata: '{"version":1}',
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

    const events = await client.getMarketEvents({ chainId: 5042002, marketId: "7" });

    expect(events).toHaveLength(1);
    expect(String(firstFetchCall(fetcher)[0])).toBe(
      "http://localhost:3001/markets/5042002/7/events"
    );
  });

  it("fetches market receipts", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(async () =>
      jsonResponse([
        {
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
        },
      ])
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    const receipts = await client.getMarketReceipts({
      chainId: 5042002,
      marketId: "7",
    });

    expect(receipts).toHaveLength(1);
    expect(String(firstFetchCall(fetcher)[0])).toBe(
      "http://localhost:3001/markets/5042002/7/receipts"
    );
  });

  it("returns empty lists when list endpoints 404", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(
      async () => new Response("Not found", { status: 404 })
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    await expect(client.getMarkets()).resolves.toEqual([]);
    await expect(
      client.getMarketEvents({ chainId: 5042002, marketId: "7" })
    ).resolves.toEqual([]);
    await expect(
      client.getMarketReceipts({ chainId: 5042002, marketId: "7" })
    ).resolves.toEqual([]);
  });

  it("raises a 404 error when graduation targets a missing market", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(
      async () => new Response("Not found", { status: 404 })
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    await expect(
      client.graduateMarket({ chainId: 5042002, marketId: "404" })
    ).rejects.toMatchObject({
      message: "Market not found.",
      name: "MarketsApiError",
      status: 404,
    });
  });

  it("appends the force flag to dev graduation requests", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(async () =>
      jsonResponse({
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
        transactionHashes: [],
      })
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    await client.graduateDevMarket({ chainId: 5042002, force: true, marketId: "7" });

    const [input] = firstFetchCall(fetcher);

    expect(String(input)).toBe(
      "http://localhost:3001/dev/markets/5042002/7/graduate?force=true"
    );
  });

  it("raises a 404 error when the dev graduation endpoint is unavailable", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(
      async () => new Response("Not found", { status: 404 })
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    await expect(
      client.graduateDevMarket({ chainId: 5042002, marketId: "7" })
    ).rejects.toMatchObject({
      message: "Dev market graduation is disabled or unavailable.",
      name: "MarketsApiError",
      status: 404,
    });
  });

  it("raises a 404 error when the dev close endpoint is unavailable", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(
      async () => new Response("Not found", { status: 404 })
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    await expect(
      client.closePregradMarket({ chainId: 5042002, marketId: "7" })
    ).rejects.toMatchObject({
      message: "Dev market close is disabled or unavailable.",
      name: "MarketsApiError",
      status: 404,
    });
  });

  it("raises a 404 error when the dev resolution endpoint is unavailable", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(
      async () => new Response("Not found", { status: 404 })
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    await expect(
      client.resolveDevMarket({ chainId: 5042002, marketId: "7", side: "yes" })
    ).rejects.toMatchObject({
      message: "Dev market resolution is disabled or unavailable.",
      name: "MarketsApiError",
      status: 404,
    });
  });

  it("falls back to the status text when an error body is empty", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(
      async () =>
        new Response(null, { status: 500, statusText: "Internal Server Error" })
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    await expect(
      client.getMarket({ chainId: 5042002, marketId: "7" })
    ).rejects.toMatchObject({
      message: "Markets API request failed (500): Internal Server Error",
      status: 500,
    });
  });

  it("surfaces raw error bodies that are not JSON", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(
      async () => new Response("upstream indexer exploded", { status: 502 })
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    await expect(
      client.getMarket({ chainId: 5042002, marketId: "7" })
    ).rejects.toMatchObject({
      message: "Markets API request failed (502): upstream indexer exploded",
      status: 502,
    });
  });

  it("surfaces JSON error bodies without a usable message field", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "nope" }), {
          headers: { "content-type": "application/json" },
          status: 500,
        })
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    await expect(
      client.getMarket({ chainId: 5042002, marketId: "7" })
    ).rejects.toMatchObject({
      message: 'Markets API request failed (500): {"error":"nope"}',
      status: 500,
    });
  });

  it("surfaces JSON error bodies with an empty message field", async () => {
    const fetcher: MockedFunction<MarketsApiFetch> = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "" }), {
          headers: { "content-type": "application/json" },
          status: 500,
        })
    );
    const client = createMarketsApiClient({
      baseUrl: "http://localhost:3001",
      fetcher,
    });

    await expect(
      client.getMarket({ chainId: 5042002, marketId: "7" })
    ).rejects.toMatchObject({
      message: 'Markets API request failed (500): {"message":""}',
      status: 500,
    });
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
