import { describe, expect, it } from "bun:test";

import {
  buildMarketCreationFeeRecord,
  type MarketCreationFeePaidLog,
} from "./market-creation-fee";

const CREATOR = "0xAAAAAAAA0000000000000000000000000000000C";

const BASE_LOG = {
  address: "0xABCDEF0000000000000000000000000000000001",
  args: { amount: 1_000_000_000_000_000_000n, creator: CREATOR, marketId: 7n },
  blockNumber: 123n,
  logIndex: 4,
  transactionHash: `0x${"33".repeat(32)}`,
};

const blockTimestamp = new Date("2026-08-04T12:00:00.000Z");

function buildFee(overrides: Partial<MarketCreationFeePaidLog["args"]> = {}) {
  return buildMarketCreationFeeRecord({
    blockTimestamp,
    config: { chainId: 5042002 },
    contractId: 42,
    log: {
      ...BASE_LOG,
      args: { ...BASE_LOG.args, ...overrides },
    } as MarketCreationFeePaidLog,
  });
}

describe("buildMarketCreationFeeRecord", () => {
  it("maps MarketCreationFeePaid to a row with the lowercased creator", () => {
    expect(buildFee().event).toMatchObject({
      amount: 1_000_000_000_000_000_000n,
      blockNumber: 123n,
      blockTimestamp,
      chainId: 5042002,
      contractId: 42,
      creator: "0xaaaaaaaa0000000000000000000000000000000c",
      logIndex: 4,
      marketId: 7n,
      transactionHash: BASE_LOG.transactionHash,
    });
  });

  it("takes the amount from the log rather than any configured fee", () => {
    // The fee is a contract constant today, but the paper trail must record
    // what actually moved — a fee change must not retroactively rewrite what
    // past creators are recorded as having paid.
    expect(buildFee({ amount: 5n }).event.amount).toBe(5n);
  });

  it("throws rather than recording a value transfer with a missing field", () => {
    // Money rows are never partially populated: a log missing the amount or
    // the payer is a decode failure, and dropping either would leave a
    // receipt that cannot be reconciled.
    expect(() => buildFee({ amount: undefined })).toThrow();
    expect(() => buildFee({ creator: undefined })).toThrow();
    expect(() => buildFee({ marketId: undefined })).toThrow();
  });

  it("distinguishes a zero value from a missing one", () => {
    // Pins the guard to a null/undefined check rather than a truthiness one.
    // Neither field is zero in practice — ids start at 1 and the contract
    // only emits when the fee is non-zero — but "absent" and "zero" mean
    // different things for a money row, and simplifying to `if (!value)`
    // would quietly merge them.
    expect(buildFee({ marketId: 0n }).event.marketId).toBe(0n);
    expect(buildFee({ amount: 0n }).event.amount).toBe(0n);
  });
});
