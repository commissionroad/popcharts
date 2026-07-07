import { describe, expect, it } from "vitest";

import type {
  ApiMarket,
  ApiReceiptPlacedEvent,
} from "@/integrations/indexer/markets-api";

import { apiMarketToMarket, pricePathFromReceipts } from "./api-market";

const market = {
  b: 5_000,
  createdAt: "2026-06-13T12:00:00.000Z",
  openingProbability: 50,
};

function receipt(
  overrides: Partial<ApiReceiptPlacedEvent> = {}
): ApiReceiptPlacedEvent {
  return {
    blockNumber: "111",
    blockTimestamp: "2026-06-13T12:05:00.000Z",
    chainId: 5042002,
    cost: "500000000000000000000",
    logIndex: 1,
    marketId: "7",
    owner: "0x0000000000000000000000000000000000000003",
    receiptId: "1",
    sequence: "1",
    shares: "1000000000000000000000",
    side: 0,
    transactionHash:
      "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    ...overrides,
  };
}

function cents(path: { cents: number }[]) {
  return path.map((point) => point.cents);
}

function apiMarket(overrides: Partial<ApiMarket> = {}): ApiMarket {
  return {
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
    totalEscrowed: "0",
    updatedAt: "2026-06-13T12:00:00.000Z",
    yesShares: "0",
    ...overrides,
  };
}

function apiMarketMetadata() {
  return {
    category: "Politics",
    chainId: 5042002,
    createdAt: "2026-06-13T12:01:00.000Z",
    description: "Resolves using the official source.",
    metadataCreatedAt: "2026-06-13T12:01:00.000Z",
    metadataHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    question: "Will this market keep its metadata?",
    resolutionCriteria: "Resolves YES if the event happens.",
    updatedAt: "2026-06-13T12:01:00.000Z",
  };
}

describe("pricePathFromReceipts", () => {
  it("starts at the opening price with no receipts", () => {
    expect(pricePathFromReceipts(market, [])).toEqual([
      { at: "2026-06-13T12:00:00.000Z", cents: 50 },
    ]);
  });

  it("moves the YES price up on YES buys and down on NO buys", () => {
    const path = cents(
      pricePathFromReceipts(market, [
        receipt({ receiptId: "1", sequence: "1", side: 0 }),
        receipt({ receiptId: "2", sequence: "2", side: 1 }),
      ])
    );

    expect(path).toHaveLength(3);
    expect(path[0]).toBe(50);
    expect(path[1]).toBeGreaterThan(50);
    expect(path[2]).toBeLessThan(path[1] ?? Number.NaN);
    // Equal-sized YES and NO buys return the market to its opening price.
    expect(path[2]).toBeCloseTo(50, 6);
  });

  it("stamps each point with the timestamp of the trade behind it", () => {
    const path = pricePathFromReceipts(market, [
      receipt({
        blockTimestamp: "2026-06-13T12:05:00.000Z",
        receiptId: "1",
        sequence: "1",
      }),
      receipt({
        blockTimestamp: "2026-06-13T12:06:00.000Z",
        receiptId: "2",
        sequence: "2",
      }),
    ]);

    expect(path.map((point) => point.at)).toEqual([
      "2026-06-13T12:00:00.000Z",
      "2026-06-13T12:05:00.000Z",
      "2026-06-13T12:06:00.000Z",
    ]);
  });

  it("omits the opening timestamp when the market creation time is unknown", () => {
    const path = pricePathFromReceipts(
      { b: market.b, openingProbability: market.openingProbability },
      []
    );

    expect(path).toEqual([{ cents: 50 }]);
  });

  it("replays receipts in sequence order regardless of input order", () => {
    const ordered = pricePathFromReceipts(market, [
      receipt({ receiptId: "1", sequence: "1", side: 0 }),
      receipt({
        receiptId: "2",
        sequence: "2",
        side: 1,
        shares: "3000000000000000000000",
      }),
    ]);
    const shuffled = pricePathFromReceipts(market, [
      receipt({
        receiptId: "2",
        sequence: "2",
        side: 1,
        shares: "3000000000000000000000",
      }),
      receipt({ receiptId: "1", sequence: "1", side: 0 }),
    ]);

    expect(shuffled).toEqual(ordered);
  });

  it("downsamples long histories while keeping the first and latest prices", () => {
    const receipts = Array.from({ length: 1_000 }, (_, index) =>
      receipt({
        receiptId: `${index + 1}`,
        sequence: `${index + 1}`,
        shares: "10000000000000000000",
        side: 0,
      })
    );

    const full = pricePathFromReceipts(market, receipts.slice(0, 100));
    const path = pricePathFromReceipts(market, receipts);

    expect(path).toHaveLength(256);
    expect(path[0]?.cents).toBe(50);
    expect(path.at(-1)?.cents).toBeGreaterThan(full.at(-1)?.cents ?? Number.NaN);
  });
});

describe("apiMarketToMarket", () => {
  it("keeps only non-blank resolution sources", () => {
    const converted = apiMarketToMarket(
      apiMarket({
        metadata: {
          ...apiMarketMetadata(),
          resolutionSources: ["   ", "https://example.com/source"],
          resolutionUrl: "https://example.com/source",
        },
      })
    );

    expect(converted.resolutionSources).toEqual(["https://example.com/source"]);
    expect(converted.resolutionUrl).toBe("https://example.com/source");
  });

  it("treats unparseable numeric strings as zero", () => {
    const converted = apiMarketToMarket(apiMarket({ receiptCount: "not-a-bigint" }));

    expect(converted.receiptCount).toBe(0);
  });

  it("carries the AI review through when present", () => {
    const aiReview: NonNullable<ApiMarket["aiReview"]> = {
      createdAt: "2026-06-13T12:02:00.000Z",
      evidence: [],
      hardFlags: [],
      id: 1,
      metadataHash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      promptVersion: "v1",
      provider: "heuristic",
      reasons: [],
      reviewedAt: "2026-06-13T12:02:00.000Z",
      scores: {
        contentSafety: 1,
        corroboration: 1,
        disputeRisk: 0,
        objectivity: 1,
        promptInjectionRisk: 0,
        publicKnowability: 1,
        sourceQuality: 1,
      },
      sourceChecks: [],
      verdict: "approve",
    };

    const converted = apiMarketToMarket(apiMarket({ aiReview }));

    expect(converted.aiReview).toEqual(aiReview);
  });

  it("generates a category from the chain id when the market id is not numeric", () => {
    const converted = apiMarketToMarket(
      apiMarket({ chainId: 3, marketId: "not-a-number" })
    );

    // generatedCategories[3 % 7]
    expect(converted.category).toBe("Weather");
  });

  it("falls back to Econ when the generated category index misses", () => {
    const converted = apiMarketToMarket(
      apiMarket({ chainId: -1, marketId: "not-a-number" })
    );

    expect(converted.category).toBe("Econ");
  });
});
