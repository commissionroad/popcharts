import { describe, expect, it } from "bun:test";

import type { MarketRefundsAvailableLog } from "src/indexer/handlers/settlement";

import {
  refundPregradMarket,
  type MarkRefundableOnChainResult,
} from "./pregrad-refund";

const REFUND_LOG = {
  args: { marketId: 7n, totalEscrowed: 125n * 10n ** 18n },
} as unknown as MarketRefundsAvailableLog;

function markRefundableReturning(result: MarkRefundableOnChainResult) {
  const calls: bigint[] = [];

  return {
    calls,
    markRefundable: async (marketId: bigint) => {
      calls.push(marketId);
      return result;
    },
  };
}

describe("refundPregradMarket", () => {
  it("opens refunds and mirrors the refunded status on-chain success", async () => {
    const blockTimestamp = new Date("2026-06-24T00:00:00.000Z");
    const { calls, markRefundable } = markRefundableReturning({
      blockTimestamp,
      kind: "refunded",
      refundLog: REFUND_LOG,
      totalEscrowed: 125n * 10n ** 18n,
      transactionHash: `0x${"a".repeat(64)}`,
    });
    const mirrored: Array<{
      blockTimestamp: Date;
      refundLog: MarketRefundsAvailableLog;
    }> = [];

    const outcome = await refundPregradMarket(
      { chainId: 31337, marketId: 7n },
      {
        markRefundable,
        mirror: async (args) => {
          mirrored.push(args);
        },
      },
    );

    expect(outcome).toBe("refunded");
    expect(calls).toEqual([7n]);
    expect(mirrored).toEqual([{ blockTimestamp, refundLog: REFUND_LOG }]);
  });

  it("reports an already-refunded market as refunded without mirroring", async () => {
    const { markRefundable } = markRefundableReturning({
      blockTimestamp: new Date("2026-06-24T00:00:00.000Z"),
      kind: "already_refunded",
    });
    let mirrorCalled = false;

    const outcome = await refundPregradMarket(
      { chainId: 31337, marketId: 7n },
      {
        markRefundable,
        mirror: async () => {
          mirrorCalled = true;
        },
      },
    );

    expect(outcome).toBe("refunded");
    expect(mirrorCalled).toBe(false);
  });

  it("skips a market that is no longer active on-chain", async () => {
    const { markRefundable } = markRefundableReturning({
      kind: "wrong_status",
      status: 3,
    });
    let mirrorCalled = false;

    const outcome = await refundPregradMarket(
      { chainId: 31337, marketId: 7n },
      {
        markRefundable,
        mirror: async () => {
          mirrorCalled = true;
        },
      },
    );

    expect(outcome).toBe("skipped");
    expect(mirrorCalled).toBe(false);
  });
});
