import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/indexer/orderbook", () => {
  it("fails with 500 when no indexer API is configured", async () => {
    const response = await GET(orderBookRequest());

    expect(response.status).toBe(500);
    expect(await errorOf(response)).toBe(
      "POPCHARTS_INDEXER_API_URL is required to read order books."
    );
  });

  it("requires both chainId and marketId query parameters", async () => {
    vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");

    const missingMarket = await GET(
      new Request("http://app.local/api/indexer/orderbook?chainId=31337")
    );
    const missingChain = await GET(
      new Request("http://app.local/api/indexer/orderbook?marketId=0xabc")
    );

    expect(missingMarket.status).toBe(400);
    expect(missingChain.status).toBe(400);
    expect(await errorOf(missingMarket)).toBe(
      "chainId and marketId query parameters are required."
    );
  });

  it("proxies the indexer's order book for the requested market", async () => {
    vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
    const book = { chainId: 31337, marketId: "0xabc" };
    const fetcher = stubUpstream(new Response(JSON.stringify(book), { status: 200 }));

    const response = await GET(orderBookRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(book);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "http://indexer:3011/markets/31337/0xabc/orderbook"
    );
  });

  it("falls back to the public indexer URL variable", async () => {
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
    const fetcher = stubUpstream(new Response("{}", { status: 200 }));

    const response = await GET(orderBookRequest());

    expect(response.status).toBe(200);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "http://indexer:3011/markets/31337/0xabc/orderbook"
    );
  });

  it("returns 404 when the indexer does not know the market", async () => {
    vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
    stubUpstream(new Response("not found", { status: 404 }));

    const response = await GET(orderBookRequest());

    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe("Order book not found.");
  });

  it("maps upstream failures to 502 with generic copy (no raw indexer message)", async () => {
    vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
    stubUpstream(
      new Response(JSON.stringify({ message: "indexer melted" }), { status: 500 })
    );

    const response = await GET(orderBookRequest());

    expect(response.status).toBe(502);
    expect(await errorOf(response)).toBe("Order book request failed.");
  });

  it("maps unexpected network failures to 500 with generic copy", async () => {
    vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      })
    );

    const response = await GET(orderBookRequest());

    expect(response.status).toBe(500);
    expect(await errorOf(response)).toBe("Order book request failed.");
  });

  it("falls back to a generic message for thrown non-Error values", async () => {
    vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "boom";
      })
    );

    const response = await GET(orderBookRequest());

    expect(response.status).toBe(500);
    expect(await errorOf(response)).toBe("Order book request failed.");
  });
});

async function errorOf(response: Response) {
  return ((await response.json()) as { error: string }).error;
}

function orderBookRequest() {
  return new Request(
    "http://app.local/api/indexer/orderbook?chainId=31337&marketId=0xabc"
  );
}

function stubUpstream(response: Response) {
  const fetcher = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>(
    async () => response.clone()
  );
  vi.stubGlobal("fetch", fetcher);

  return fetcher;
}
