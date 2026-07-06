import { describe, expect, it } from "vitest";

import type { ApiReceiptPlacedEvent } from "@/integrations/indexer/markets-api";

import { pricePathFromReceipts } from "./api-market";

const market = { b: 5_000, openingProbability: 50 };

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

describe("pricePathFromReceipts", () => {
  it("starts at the opening price with no receipts", () => {
    expect(pricePathFromReceipts(market, [])).toEqual([50]);
  });

  it("moves the YES price up on YES buys and down on NO buys", () => {
    const path = pricePathFromReceipts(market, [
      receipt({ receiptId: "1", sequence: "1", side: 0 }),
      receipt({ receiptId: "2", sequence: "2", side: 1 }),
    ]);

    expect(path).toHaveLength(3);
    expect(path[0]).toBe(50);
    expect(path[1]).toBeGreaterThan(50);
    expect(path[2]).toBeLessThan(path[1] ?? Number.NaN);
    // Equal-sized YES and NO buys return the market to its opening price.
    expect(path[2]).toBeCloseTo(50, 6);
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
    expect(path[0]).toBe(50);
    expect(path.at(-1)).toBeGreaterThan(full.at(-1) ?? Number.NaN);
  });
});
