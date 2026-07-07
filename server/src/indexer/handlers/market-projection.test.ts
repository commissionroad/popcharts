import { describe, expect, it } from "bun:test";

import {
  MarketNotIndexedError,
  retryUntilMarketIndexed,
} from "./market-projection";

const notIndexed = () =>
  new MarketNotIndexedError({ chainId: 5042002, marketId: 7n });

describe("retryUntilMarketIndexed", () => {
  it("retries until the operation stops reporting a missing market", async () => {
    let attempts = 0;
    const result = await retryUntilMarketIndexed(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw notIndexed();
        }
        return "persisted";
      },
      { attempts: 5, delayMs: 1, label: "MarketReviewApproved" },
    );

    expect(result).toBe("persisted");
    expect(attempts).toBe(3);
  });

  it("rethrows after exhausting attempts so the block cursor stays behind", async () => {
    let attempts = 0;

    await expect(
      retryUntilMarketIndexed(
        async () => {
          attempts += 1;
          throw notIndexed();
        },
        { attempts: 2, delayMs: 1, label: "GraduationStarted" },
      ),
    ).rejects.toBeInstanceOf(MarketNotIndexedError);
    expect(attempts).toBe(2);
  });

  it("does not retry unrelated errors", async () => {
    let attempts = 0;

    await expect(
      retryUntilMarketIndexed(
        async () => {
          attempts += 1;
          throw new Error("connection refused");
        },
        { attempts: 5, delayMs: 1, label: "ReceiptPlaced" },
      ),
    ).rejects.toThrow("connection refused");
    expect(attempts).toBe(1);
  });
});
