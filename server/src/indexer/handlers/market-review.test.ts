import { describe, expect, it } from "bun:test";

import {
  MarketNotIndexedError,
  retryUntilMarketIndexed,
} from "./market-projection";
import {
  buildMarketReviewStatusUpdate,
  persistMarketReviewStatusUpdate,
  type MarketReviewLog,
  type MarketReviewStatusUpdate,
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

describe("persistMarketReviewStatusUpdate", () => {
  const update: MarketReviewStatusUpdate = {
    chainId: 5042002,
    marketId: 7n,
    status: "bootstrap",
    updatedAt: new Date("2026-06-13T12:00:00.000Z"),
  };

  it("throws MarketNotIndexedError when the approval is processed before MarketCreated", async () => {
    const { dbc } = fakeReviewDb({});

    await expect(
      persistMarketReviewStatusUpdate(update, dbc),
    ).rejects.toBeInstanceOf(MarketNotIndexedError);
  });

  it("applies the status change to a market still under review", async () => {
    const { dbc, setCalls } = fakeReviewDb({ updatedRows: [{ id: 1 }] });

    await persistMarketReviewStatusUpdate(update, dbc);

    expect(setCalls).toEqual([
      { status: "bootstrap", updatedAt: update.updatedAt },
    ]);
  });

  it("treats a market that already moved past review as an idempotent no-op", async () => {
    const { dbc, setCalls } = fakeReviewDb({ market: { id: 1 } });

    await persistMarketReviewStatusUpdate(update, dbc);

    expect(setCalls).toHaveLength(1);
  });

  it("recovers an approval that raced ahead of MarketCreated once the market row lands", async () => {
    // Regression for approval-before-creation ordering: the first attempts see
    // no markets row (MarketCreated not persisted yet); the retry loop must
    // keep the update alive until the market-created watcher catches up.
    let attempts = 0;
    const marketIndexedOnAttempt = 3;

    await retryUntilMarketIndexed(
      () => {
        attempts += 1;
        const { dbc } = fakeReviewDb(
          attempts < marketIndexedOnAttempt ? {} : { updatedRows: [{ id: 1 }] },
        );
        return persistMarketReviewStatusUpdate(update, dbc);
      },
      { attempts: 5, delayMs: 1, label: "MarketReviewApproved" },
    );

    expect(attempts).toBe(marketIndexedOnAttempt);
  });
});

/**
 * Minimal stand-in for the drizzle handle used by the persist path: `market`
 * is what the existence probe finds, `updatedRows` is what the guarded UPDATE
 * matches. Both default to "market not indexed yet".
 */
function fakeReviewDb({
  market,
  updatedRows = [],
}: {
  market?: { id: number };
  updatedRows?: Array<{ id: number }>;
}) {
  const setCalls: unknown[] = [];
  const dbc = {
    query: {
      markets: {
        findFirst: async () => market,
      },
    },
    update: () => ({
      set: (values: unknown) => {
        setCalls.push(values);
        return {
          where: () => ({
            returning: async () => updatedRows,
          }),
        };
      },
    }),
  } as unknown as Parameters<typeof persistMarketReviewStatusUpdate>[1];

  return { dbc, setCalls };
}
