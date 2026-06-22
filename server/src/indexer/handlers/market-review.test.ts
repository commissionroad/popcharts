import { describe, expect, it } from "bun:test";

import {
  buildMarketReviewStatusUpdate,
  type MarketReviewLog,
} from "./market-review";

describe("buildMarketReviewStatusUpdate", () => {
  it("maps a review event into a market status update", () => {
    const blockTimestamp = new Date("2026-06-13T12:00:00.000Z");
    const log = {
      args: {
        marketId: 7n,
        reviewer: "0x00000000000000000000000000000000000000AA",
      },
    } as unknown as MarketReviewLog;

    expect(
      buildMarketReviewStatusUpdate({
        blockTimestamp,
        config: { chainId: 5042002 },
        log,
        status: "bootstrap",
      }),
    ).toEqual({
      chainId: 5042002,
      marketId: 7n,
      status: "bootstrap",
      updatedAt: blockTimestamp,
    });
  });

  it("throws when required log metadata is missing", () => {
    const log = { args: {} } as unknown as MarketReviewLog;

    expect(() =>
      buildMarketReviewStatusUpdate({
        blockTimestamp: new Date("2026-06-13T12:00:00.000Z"),
        config: { chainId: 5042002 },
        log,
        status: "rejected",
      }),
    ).toThrow("marketId");
  });
});
