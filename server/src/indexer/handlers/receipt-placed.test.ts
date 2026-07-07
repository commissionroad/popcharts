import { describe, expect, it } from "bun:test";

import { MarketNotIndexedError } from "./market-projection";
import {
  buildReceiptPlacedRecord,
  persistReceiptPlacedRecord,
  type ReceiptPlacedLog,
} from "./receipt-placed";

describe("buildReceiptPlacedRecord", () => {
  it("maps a ReceiptPlaced log into a raw event row", () => {
    const blockTimestamp = new Date("2026-06-14T12:00:00.000Z");
    const log = {
      args: {
        cost: 50_400_000_000_000_000_000n,
        marketId: 7n,
        owner: "0x00000000000000000000000000000000000000AA",
        rHigh: 100_000_000_000_000_000_000n,
        rLow: -25_000_000_000_000_000_000n,
        receiptId: 11n,
        sequence: 3n,
        shares: 100_000_000_000_000_000_000n,
        side: 0,
      },
      blockNumber: 321n,
      logIndex: 9,
      transactionHash:
        "0x3333333333333333333333333333333333333333333333333333333333333333",
    } as unknown as ReceiptPlacedLog;

    const record = buildReceiptPlacedRecord({
      blockTimestamp,
      config: { chainId: 5042002 },
      contractId: 42,
      log,
    });

    expect(record).toMatchObject({
      blockNumber: 321n,
      blockTimestamp,
      chainId: 5042002,
      contractId: 42,
      cost: 50_400_000_000_000_000_000n,
      logIndex: 9,
      marketId: 7n,
      owner: "0x00000000000000000000000000000000000000aa",
      rHigh: "100000000000000000000",
      rLow: "-25000000000000000000",
      receiptId: 11n,
      sequence: 3n,
      shares: 100_000_000_000_000_000_000n,
      side: 0,
      transactionHash:
        "0x3333333333333333333333333333333333333333333333333333333333333333",
    });
  });

  it("throws when required receipt log metadata is missing", () => {
    const log = {
      args: {},
      blockNumber: 321n,
      logIndex: null,
      transactionHash:
        "0x3333333333333333333333333333333333333333333333333333333333333333",
    } as unknown as ReceiptPlacedLog;

    expect(() =>
      buildReceiptPlacedRecord({
        blockTimestamp: new Date("2026-06-14T12:00:00.000Z"),
        config: { chainId: 5042002 },
        contractId: 42,
        log,
      }),
    ).toThrow("cost");
  });
});

describe("persistReceiptPlacedRecord", () => {
  it("throws MarketNotIndexedError when the receipt lands before MarketCreated", async () => {
    const record = buildReceiptPlacedRecord({
      blockTimestamp: new Date("2026-06-14T12:00:00.000Z"),
      config: { chainId: 5042002 },
      contractId: 42,
      log: {
        args: {
          cost: 50_400_000_000_000_000_000n,
          marketId: 7n,
          owner: "0x00000000000000000000000000000000000000AA",
          rHigh: 100_000_000_000_000_000_000n,
          rLow: -25_000_000_000_000_000_000n,
          receiptId: 11n,
          sequence: 3n,
          shares: 100_000_000_000_000_000_000n,
          side: 0,
        },
        blockNumber: 321n,
        logIndex: 9,
        transactionHash:
          "0x3333333333333333333333333333333333333333333333333333333333333333",
      } as unknown as ReceiptPlacedLog,
    });

    // The event insert succeeds but the markets UPDATE matches no row; the
    // thrown error must roll back the transaction so a replay is not skipped
    // by the onConflictDoNothing dedup.
    const tx = {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: async () => [{ id: 1 }],
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [],
          }),
        }),
      }),
    };
    const dbc = {
      transaction: (callback: (handle: typeof tx) => Promise<void>) =>
        callback(tx),
    } as unknown as Parameters<typeof persistReceiptPlacedRecord>[1];

    await expect(
      persistReceiptPlacedRecord(record, dbc),
    ).rejects.toBeInstanceOf(MarketNotIndexedError);
  });
});
