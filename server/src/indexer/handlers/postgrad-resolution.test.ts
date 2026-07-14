import { describe, expect, it } from "bun:test";

import {
  buildPostgradResolutionRecord,
  type PostgradMarketResolvedLog,
} from "./postgrad-resolution";

const BASE_LOG = {
  address: "0xABCDEF0000000000000000000000000000000001",
  blockNumber: 123n,
  logIndex: 4,
  transactionHash: `0x${"22".repeat(32)}`,
};

const blockTimestamp = new Date("2026-06-13T12:00:00.000Z");

describe("buildPostgradResolutionRecord", () => {
  it("maps MarketResolved(side=0) to a resolved event with winning side yes", () => {
    const record = buildPostgradResolutionRecord({
      blockTimestamp,
      config: { chainId: 5042002 },
      contractId: 42,
      kind: "resolved",
      log: { ...BASE_LOG, args: { side: 0 } } as PostgradMarketResolvedLog,
      marketId: 7n,
    });

    expect(record.event).toMatchObject({
      blockNumber: 123n,
      blockTimestamp,
      chainId: 5042002,
      contractId: 42,
      kind: "resolved",
      logIndex: 4,
      marketId: 7n,
      postgradMarket: BASE_LOG.address.toLowerCase(),
      winningSide: "yes",
    });
  });

  it("maps MarketResolved(side=1) to winning side no", () => {
    const record = buildPostgradResolutionRecord({
      blockTimestamp,
      config: { chainId: 5042002 },
      contractId: 42,
      kind: "resolved",
      log: { ...BASE_LOG, args: { side: 1 } } as PostgradMarketResolvedLog,
      marketId: 7n,
    });

    expect(record.event.winningSide).toBe("no");
  });

  it("maps MarketCancelled to a cancelled event with no winning side", () => {
    const record = buildPostgradResolutionRecord({
      blockTimestamp,
      config: { chainId: 5042002 },
      contractId: 42,
      kind: "cancelled",
      log: { ...BASE_LOG, args: {} } as PostgradMarketResolvedLog,
      marketId: 7n,
    });

    expect(record.event.kind).toBe("cancelled");
    expect(record.event.winningSide).toBeNull();
  });

  it("throws when a resolved log is missing its side", () => {
    expect(() =>
      buildPostgradResolutionRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "resolved",
        log: { ...BASE_LOG, args: {} } as PostgradMarketResolvedLog,
        marketId: 7n,
      }),
    ).toThrow("side");
  });

  it("throws when required log metadata is missing", () => {
    expect(() =>
      buildPostgradResolutionRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "resolved",
        log: {
          ...BASE_LOG,
          args: { side: 0 },
          blockNumber: null,
        } as unknown as PostgradMarketResolvedLog,
        marketId: 7n,
      }),
    ).toThrow("blockNumber");
  });
});
