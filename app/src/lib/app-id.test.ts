import { describe, expect, it } from "vitest";

import { apiMarketAppId, parseApiMarketAppId } from "./app-id";

describe("apiMarketAppId", () => {
  it("joins the chain and market ids with a colon", () => {
    expect(apiMarketAppId({ chainId: 5042002, marketId: "7" })).toBe("5042002:7");
  });
});

describe("parseApiMarketAppId", () => {
  it("parses a chainId:marketId pair", () => {
    expect(parseApiMarketAppId("5042002:7")).toEqual({
      chainId: 5042002,
      marketId: "7",
    });
  });

  it("decodes URL-encoded ids from route paths", () => {
    expect(parseApiMarketAppId("5042002%3A7")).toEqual({
      chainId: 5042002,
      marketId: "7",
    });
  });

  it("returns null when a part is missing", () => {
    expect(parseApiMarketAppId("")).toBeNull();
    expect(parseApiMarketAppId("5042002")).toBeNull();
    expect(parseApiMarketAppId("5042002:")).toBeNull();
    expect(parseApiMarketAppId(":7")).toBeNull();
  });

  it("returns null for extra segments", () => {
    expect(parseApiMarketAppId("5042002:7:extra")).toBeNull();
  });

  it("returns null for a non-numeric chain id", () => {
    expect(parseApiMarketAppId("devchain:7")).toBeNull();
  });

  it("falls back to the raw value when percent-decoding fails", () => {
    expect(parseApiMarketAppId("50%GG:7")).toEqual({ chainId: 50, marketId: "7" });
  });
});
